const express = require("express")
const StrokeLog = require("./log")

const app = express()
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

// ✅ CRDT replication (merge, not append)
async function replicateToFollowers(entry) {
    if (PEERS.length === 0) return []

    const results = await Promise.all(
        PEERS.map(async (peerUrl) => {
            try {
                const response = await fetch(`${peerUrl}/merge`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ strokes: [entry] })
                })

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`)
                }

                return { peerUrl, success: true }
            } catch (error) {
                return { peerUrl, success: false, error: error.message }
            }
        })
    )

    return results
}

// ❌ no longer clearing logs blindly — still allowed via replaceAll
async function clearFollowersLog() {
    if (PEERS.length === 0) return []

    const results = await Promise.all(
        PEERS.map(async (peerUrl) => {
            try {
                const response = await fetch(`${peerUrl}/sync-log`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ entries: [] })
                })

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`)
                }

                return { peerUrl, success: true }
            } catch (error) {
                return { peerUrl, success: false, error: error.message }
            }
        })
    )

    return results
}

// ✅ LEADER receives stroke → merge (CRDT)
app.post("/stroke", async (req, res) => {
    if (state !== "leader") {
        return res.status(400).json({
            error: "This replica is not the leader"
        })
    }

    const { entry } = req.body || {}

    if (!entry || entry.type !== "stroke" || !entry.id) {
        return res.status(400).json({
            error: "Invalid stroke entry (missing id/type)"
        })
    }

    // ✅ CRDT merge instead of append
    strokeLog.merge([entry])

    const replicationResults = await replicateToFollowers(entry)

    const successCount = replicationResults.filter(r => r.success).length + 1
    const MAJORITY = Math.floor((PEERS.length + 1) / 2) + 1

    if (successCount >= MAJORITY) {
        return res.json({
            success: true,
            committed: true,
            replicaId: REPLICA_ID
        })
    }

    return res.status(500).json({
        success: false,
        error: "Failed to reach majority"
    })
})

// ✅ CRDT clear
app.post("/clear", async (req, res) => {
    if (state !== "leader") {
        return res.status(400).json({
            error: "This replica is not the leader"
        })
    }

    strokeLog.replaceAll([])

    const replicationResults = await clearFollowersLog()

    const successCount = replicationResults.filter(r => r.success).length + 1
    const MAJORITY = Math.floor((PEERS.length + 1) / 2) + 1

    if (successCount >= MAJORITY) {
        return res.json({
            success: true,
            committed: true,
            replicaId: REPLICA_ID
        })
    }

    return res.status(500).json({
        success: false,
        error: "Failed to reach majority"
    })
})

// ✅ NEW CRDT MERGE ENDPOINT
app.post("/merge", (req, res) => {
    const { strokes } = req.body || {}

    if (!Array.isArray(strokes)) {
        return res.status(400).json({
            error: "Invalid strokes payload"
        })
    }

    strokeLog.merge(strokes)

    return res.json({
        success: true,
        replicaId: REPLICA_ID
    })
})

// ✅ LOG READ
app.get("/log", (req, res) => {
    res.json({
        replicaId: REPLICA_ID,
        isLeader: state === "leader",
        log: strokeLog.getAll()
    })
})

// ✅ SYNC (CRDT-safe replace + merge)
app.post("/sync-log", (req, res) => {
    const { entries } = req.body || {}

    if (!Array.isArray(entries)) {
        return res.status(400).json({
            success: false,
            error: "Invalid entries payload"
        })
    }

    strokeLog.replaceAll(entries)

    return res.json({
        success: true,
        replicaId: REPLICA_ID,
        length: entries.length
    })
})

// HEARTBEAT
app.post("/heartbeat", (req, res) => {
    const { leaderId } = req.body

    if (state === "leader") {
        return res.json({ success: true })
    }

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
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leaderId: REPLICA_ID })
            })
        } catch {
            console.log("Heartbeat failed to", peer)
        }
    }
}

async function detectLeaderFailure() {
    if (state === "leader") return

    const now = Date.now()

    if (now - lastHeartbeat > HEARTBEAT_TIMEOUT) {
        console.log(`[${REPLICA_ID}] Leader timeout → becoming leader`)
        state = "leader"
        currentLeader = REPLICA_ID
        lastHeartbeat = Date.now()

        await sendHeartbeats()
    }
}

// ✅ periodic sync (still valid with CRDT)
async function syncFollowersLog() {
    if (state !== "leader") return

    const leaderLog = strokeLog.getAll()

    for (const peer of PEERS) {
        try {
            const logRes = await fetch(`${peer}/log`)
            if (!logRes.ok) continue

            const data = await logRes.json()
            const followerLog = Array.isArray(data.log) ? data.log : []

            if (followerLog.length < leaderLog.length) {
                await fetch(`${peer}/sync-log`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ entries: leaderLog })
                })
            }
        } catch (err) {
            console.error(`[${REPLICA_ID}] Sync failed`, peer, err.message)
        }
    }
}

app.listen(PORT, () => {
    console.log(`[${REPLICA_ID}] running on port ${PORT} (leader=${IS_LEADER})`)
})

setInterval(sendHeartbeats, HEARTBEAT_INTERVAL)
setInterval(detectLeaderFailure, 1000)
setInterval(syncFollowersLog, SYNC_INTERVAL)