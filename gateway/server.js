const express = require("express")
const WebSocket = require("ws")
const cors = require("cors")

const app = express()
app.use(cors())

const PORT = 3000

const server = app.listen(PORT, () => {
    console.log("Gateway running on port", PORT)
})

const wss = new WebSocket.Server({ server })

let strokes = []

wss.on("connection", (ws) => {

    console.log("Client connected")

    // send existing strokes to new client
    ws.send(JSON.stringify({
        type: "init",
        strokes: strokes
    }))

    ws.on("message", (message) => {

        const stroke = JSON.parse(message)

        if (stroke.type === "stroke") {

            strokes.push(stroke)

            // broadcast to all clients
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(stroke))
                }
            })
        }
    })

    ws.on("close", () => {
        console.log("Client disconnected")
    })
})