class StrokeLog {
    constructor() {
        this.entries = []
    }

    append(entry) {
        this.entries.push(entry)
        return this.entries.length - 1
    }

    getAll() {
        return [...this.entries]
    }
}

module.exports = StrokeLog
