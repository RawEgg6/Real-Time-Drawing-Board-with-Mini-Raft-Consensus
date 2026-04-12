const express = require("express")
const StrokeLog = require("./log")

const app = express()
// Increase JSON body size limit so /sync-log can handle large logs
app.use(express.json({ limit: "10mb" }))

const REPLICA_ID = process.env.REPLICA_ID || "replica1"
const PORT = Number(process.env.PORT || 4001)
const IS_LEADER = String(process.env.IS_LEADER || "false").toLowerCase() === "true"
const PEERS = (process.env.PEERS || "")
    .split(",")
    .map((peer) => peer.trim())
    .filter(Boolean)

const strokeLog = new StrokeLog()

let state = IS_LEADER ? "leader" : "follower"
let currentLeader = IS_LEADER ? REPLICA_ID : null
let lastHeartbeat = Date.now()

const HEARTBEAT_INTERVAL = 1000
const HEARTBEAT_TIMEOUT = 3000
const SYNC_INTERVAL = 5000

async function replicateToFollowers(entry) {
    if (PEERS.length === 0) {
        return []
    }

    const results = await Promise.all(
        PEERS.map(async (peerUrl) => {
            try {
                const response = await fetch(`${peerUrl}/append-entry`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ entry })
                })

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`)
                }

                return {
                    peerUrl,
                    success: true
                }
            } catch (error) {
                return {
                    peerUrl,
                    success: false,
                    error: error.message
                }
            }
        })
    )

    return results
}

app.post("/stroke", async (req, res) => {
    if (state !== "leader") {
        return res.status(400).json({
            error: "This replica is not the leader"
        })
    }

    const { entry } = req.body || {}

    if (!entry || entry.type !== "stroke") {
        return res.status(400).json({
            error: "Invalid stroke entry"
        })
    }

    strokeLog.append(entry)
    const replicationResults = await replicateToFollowers(entry)
    //phase 5
    // count successful replicas
    const successCount = replicationResults.filter(r => r.success).length + 1
    const MAJORITY = Math.floor((PEERS.length + 1) / 2) + 1
if (successCount >= MAJORITY) {
    return res.json({
        success: true,
        committed: true,
        replicaId: REPLICA_ID
    })
} else {
    console.error("Not enough replicas for commit")

    return res.status(500).json({
        success: false,
        error: "Failed to reach majority"
    })
}
    /*const failedReplications = replicationResults.filter((result) => !result.success)
    if (failedReplications.length > 0) {
        console.error("Replication failures:", failedReplications)
    }

    return res.json({
        success: true,
        replicaId: REPLICA_ID,
        replicatedTo: replicationResults
    }) */
})

app.post("/append-entry", (req, res) => {
    const { entry } = req.body || {}

    if (!entry || entry.type !== "stroke") {
        return res.status(400).json({
            error: "Invalid stroke entry"
        })
    }

    strokeLog.append(entry)

    return res.json({
        success: true,
        replicaId: REPLICA_ID
    })
})

app.get("/log", (req, res) => {
    res.json({
        replicaId: REPLICA_ID,
        isLeader: IS_LEADER,
        log: strokeLog.getAll()
    })
})

// phase 6 - log synchronization endpoint
app.post("/sync-log", (req, res) => {
    const { entries } = req.body || {}

    if (!Array.isArray(entries)) {
        return res.status(400).json({
            success: false,
            error: "Invalid entries payload"
        })
    }

    strokeLog.setAll(entries)

    return res.json({
        success: true,
        replicaId: REPLICA_ID,
        length: entries.length
    })
})

//phase 4 - heartbeat
app.post("/heartbeat", (req, res) => {
    const { leaderId } = req.body

    state = "follower"
    currentLeader = leaderId
    lastHeartbeat = Date.now()

    return res.json({ success: true })
})

app.get("/status", (req, res) => {
    res.json({
        replicaId: REPLICA_ID,
        state
    })
})

async function sendHeartbeats() {
    if (state !== "leader") return

    for (const peer of PEERS) {
        try {
            await fetch(`${peer}/heartbeat`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    leaderId: REPLICA_ID
                })
            })
        } catch (err) {
            console.log("Heartbeat failed to", peer)
        }
    }
}

function detectLeaderFailure() {
    if (state === "leader") return

    const now = Date.now()

    if (state !== "leader" && now - lastHeartbeat > HEARTBEAT_TIMEOUT) {
        console.log(`[${REPLICA_ID}] Leader timeout → becoming leader`)
        state = "leader"
        currentLeader = REPLICA_ID
    }
}

// phase 6 - periodically ensure followers are caught up with leader's log
async function syncFollowersLog() {
    if (state !== "leader") return

    const leaderLog = strokeLog.getAll()

    for (const peer of PEERS) {
        try {
            const logRes = await fetch(`${peer}/log`)

            if (!logRes.ok) {
                continue
            }

            const data = await logRes.json()
            const followerLog = Array.isArray(data.log) ? data.log : []

            if (followerLog.length < leaderLog.length) {
                try {
                    await fetch(`${peer}/sync-log`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({ entries: leaderLog })
                    })
                } catch (err) {
                    console.error(`[${REPLICA_ID}] Failed to sync log to`, peer, err.message)
                }
            }
        } catch (err) {
            console.error(`[${REPLICA_ID}] Failed to check follower log`, peer, err.message)
        }
    }
}

app.listen(PORT, () => {
    console.log(`[${REPLICA_ID}] running on port ${PORT} (leader=${IS_LEADER})`)
    if (IS_LEADER) {
        console.log(`[${REPLICA_ID}] followers:`, PEERS.length > 0 ? PEERS.join(", ") : "none")
    }
})

//phase 4 addition: loops
setInterval(sendHeartbeats, HEARTBEAT_INTERVAL)
setInterval(detectLeaderFailure, 1000)
setInterval(syncFollowersLog, SYNC_INTERVAL)