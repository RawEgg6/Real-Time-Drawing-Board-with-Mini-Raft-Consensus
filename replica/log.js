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

    // Replace the entire log with a new set of entries
    setAll(entries) {
        this.entries = Array.isArray(entries) ? [...entries] : []
    }
}

module.exports = StrokeLog
