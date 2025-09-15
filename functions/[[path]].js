import teamsData from '../public/teams.json';
import scriptData from '../public/script.json';

// Durable Objectの本体クラス
export class StateManager {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.sessions = [];
        this.state.storage.get(["matchup", "scriptIndex", "comments"]).then(stored => {
            this.matchup = stored.get("matchup") || { alphaTeamId: null, bravoTeamId: null };
            this.scriptIndex = stored.get("scriptIndex") || 0;
            this.comments = stored.get("comments") || [];
        });
    }

    async handleHttpRequest(request) {
        const url = new URL(request.url);
        if (url.pathname === "/api/initial-data") {
            // APIを呼び出す代わりに、インポートしたJSONデータを直接返す
            return new Response(JSON.stringify({ teamsData, scriptData }), {
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
        }
        if (url.pathname === "/api/websocket") {
            const upgradeHeader = request.headers.get("Upgrade");
            if (upgradeHeader !== "websocket") {
                return new Response("Expected WebSocket upgrade", { status: 426 });
            }
            const [client, server] = Object.values(new WebSocketPair());
            await this.handleSession(server);
            return new Response(null, { status: 101, webSocket: client });
        }
        return new Response("Not found", { status: 404 });
    }

    async handleSession(webSocket) {
        webSocket.accept();
        const session = { webSocket, id: crypto.randomUUID() };
        this.sessions.push(session);
        webSocket.send(JSON.stringify({
            type: "initialState",
            payload: { matchup: this.matchup, scriptIndex: this.scriptIndex, comments: this.comments, sessionId: session.id },
        }));
        webSocket.addEventListener("message", async msg => {
            const message = JSON.parse(msg.data);
            await this.handleMessage(message, session);
        });
        const closeOrErrorHandler = () => { this.sessions = this.sessions.filter(s => s !== session); };
        webSocket.addEventListener("close", closeOrErrorHandler);
        webSocket.addEventListener("error", closeOrErrorHandler);
    }

    async handleMessage(message, session) {
        switch (message.type) {
            case "setMatchup":
                this.matchup = message.payload;
                this.broadcast({ type: "matchupUpdated", payload: this.matchup });
                await this.state.storage.put("matchup", this.matchup);
                break;
            case "advanceScript":
                this.scriptIndex++;
                this.broadcast({ type: "scriptUpdated", payload: { newIndex: this.scriptIndex } });
                await this.state.storage.put("scriptIndex", this.scriptIndex);
                break;
            case "postComment":
                const newComment = { senderId: session.id, text: message.payload.text };
                this.comments.push(newComment);
                if (this.comments.length > 2) this.comments.shift();
                this.broadcast({ type: "commentAdded", payload: this.comments });
                await this.state.storage.put("comments", this.comments);
                break;
        }
    }

    broadcast(message) {
        const serializedMessage = JSON.stringify(message);
        this.sessions = this.sessions.filter(session => {
            try { session.webSocket.send(serializedMessage); return true; }
            catch (err) { return false; }
        });
    }
}

// エントリーポイント
export default {
    async fetch(request, env) {
        let id = env.STATE_MANAGER.idFromName("v1");
        let durableObject = env.STATE_MANAGER.get(id);
        return durableObject.handleHttpRequest(request, env);
    }
}