const TIMEOUT = 3000

function startElectionWatcher(state) {
    setInterval(() => {
        if (state.isLeader()) return

        const now = Date.now()

        if (now - state.lastHeartbeat > TIMEOUT) {
            console.log(`[${state.replicaId}] Leader timeout`)
            state.becomeLeader()
        }
    }, 1000)
}

module.exports = {
    startElectionWatcher
}