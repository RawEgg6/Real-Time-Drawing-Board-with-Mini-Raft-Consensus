const express = require("express")
const StrokeLog = require("./log")

const app = express()
app.use(express.json())

const REPLICA_ID = process.env.REPLICA_ID || "replica1"
const PORT = Number(process.env.PORT || 4001)
const IS_LEADER = String(process.env.IS_LEADER || "false").toLowerCase() === "true"
const PEERS = (process.env.PEERS || "")
    .split(",")
    .map((peer) => peer.trim())
    .filter(Boolean)

const strokeLog = new StrokeLog()

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
    if (!IS_LEADER) {
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

    const failedReplications = replicationResults.filter((result) => !result.success)
    if (failedReplications.length > 0) {
        console.error("Replication failures:", failedReplications)
    }

    return res.json({
        success: true,
        replicaId: REPLICA_ID,
        replicatedTo: replicationResults
    })
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

app.listen(PORT, () => {
    console.log(`[${REPLICA_ID}] running on port ${PORT} (leader=${IS_LEADER})`)
    if (IS_LEADER) {
        console.log(`[${REPLICA_ID}] followers:`, PEERS.length > 0 ? PEERS.join(", ") : "none")
    }
})
