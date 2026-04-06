async function replicateToFollowers(entry, peers) {
    const results = await Promise.all(
        peers.map(async (peer) => {
            try {
                const res = await fetch(`${peer}/append-entry`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ entry })
                })

                if (!res.ok) throw new Error()

                return { peer, success: true }
            } catch (err) {
                return { peer, success: false }
            }
        })
    )

    return results
}

module.exports = {
    replicateToFollowers
}