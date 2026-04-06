class State {
    constructor(isLeader, replicaId) {
        this.replicaId = replicaId
        this.state = isLeader ? "leader" : "follower"
        this.currentLeader = isLeader ? replicaId : null
        this.lastHeartbeat = Date.now()
    }

    becomeLeader() {
        this.state = "leader"
        this.currentLeader = this.replicaId
        console.log(`[${this.replicaId}] Became LEADER`)
    }

    becomeFollower(leaderId) {
        this.state = "follower"
        this.currentLeader = leaderId
        this.lastHeartbeat = Date.now()
    }

    isLeader() {
        return this.state === "leader"
    }
}

module.exports = State