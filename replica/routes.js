const express = require("express")
const { replicateToFollowers } = require("./replication")
const { handleHeartbeat } = require("./heartbeat")

function createRoutes(state, log, peers) {
    const router = express.Router()

    // Submit stroke (leader only)
    router.post("/stroke", async (req, res) => {
        if (!state.isLeader()) {
            return res.status(400).json({ error: "Not leader" })
        }

        const { entry } = req.body

        log.append(entry)

        await replicateToFollowers(entry, peers)

        res.json({ success: true })
    })

    // Follower replication
    router.post("/append-entry", (req, res) => {
        const { entry } = req.body
        log.append(entry)
        res.json({ success: true })
    })

    // Heartbeat
    router.post("/heartbeat", (req, res) => {
        handleHeartbeat(state, req.body.leaderId)
        res.json({ success: true })
    })

    // Status (for gateway)
    router.get("/status", (req, res) => {
        res.json({
            replicaId: state.replicaId,
            state: state.state
        })
    })

    // Log
    router.get("/log", (req, res) => {
        res.json({
            log: log.getAll()
        })
    })

    return router
}

module.exports = createRoutes