class StrokeLog {
    constructor() {
        this.map = new Map()
    }

    merge(strokes) {
        for (const stroke of strokes) {
            if (!this.map.has(stroke.id)) {
                this.map.set(stroke.id, stroke)
            }
        }
    }

    getAll() {
        return Array.from(this.map.values()).sort((a, b) => {
            if (a.seq !== b.seq) return a.seq - b.seq
            return a.userId.localeCompare(b.userId)
        })
    }

    replaceAll(entries) {
        this.map.clear()
        this.merge(entries)
    }
}

module.exports = StrokeLog