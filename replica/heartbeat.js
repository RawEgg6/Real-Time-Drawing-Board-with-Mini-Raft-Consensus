async function sendHeartbeats(state, peers) {
    if (!state.isLeader()) return

    for (const peer of peers) {
        try {
            await fetch(`${peer}/heartbeat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    leaderId: state.replicaId
                })
            })
        } catch (err) {
            console.log("Heartbeat failed to", peer)
        }
    }
}

function startHeartbeatLoop(state, peers) {
    setInterval(() => {
        sendHeartbeats(state, peers)
    }, 1000)
}

function handleHeartbeat(state, leaderId) {
    state.becomeFollower(leaderId)
}

module.exports = {
    startHeartbeatLoop,
    handleHeartbeat
}