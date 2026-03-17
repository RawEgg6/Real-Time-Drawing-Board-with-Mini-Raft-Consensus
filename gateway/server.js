const express = require("express")
const WebSocket = require("ws")
const cors = require("cors")

const app = express()
app.use(cors())

const PORT = 3000
const LEADER_URL = process.env.LEADER_URL || "http://localhost:4001"

const server = app.listen(PORT, () => {
    console.log("Gateway running on port", PORT)
})

const wss = new WebSocket.Server({ server })

async function getStrokeLogFromLeader() {
    try {
        const response = await fetch(`${LEADER_URL}/log`)

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
        }

        const data = await response.json()
        return Array.isArray(data.log) ? data.log : []
    } catch (error) {
        console.error("Failed to fetch stroke log from leader:", error.message)
        return []
    }
}

async function forwardStrokeToLeader(stroke) {
    const response = await fetch(`${LEADER_URL}/stroke`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ entry: stroke })
    })

    if (!response.ok) {
        const body = await response.text()
        throw new Error(`Leader rejected stroke: HTTP ${response.status} ${body}`)
    }
}

function broadcastStroke(stroke) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(stroke))
        }
    })
}

wss.on("connection", (ws) => {

    console.log("Client connected")

    getStrokeLogFromLeader().then((strokes) => {
        ws.send(JSON.stringify({
            type: "init",
            strokes: strokes
        }))
    })

    ws.on("message", async (message) => {

        const stroke = JSON.parse(message)

        if (stroke.type === "stroke") {
            try {
                await forwardStrokeToLeader(stroke)
                broadcastStroke(stroke)
            } catch (error) {
                console.error("Failed to process stroke:", error.message)
            }
        }
    })

    ws.on("close", () => {
        console.log("Client disconnected")
    })
})