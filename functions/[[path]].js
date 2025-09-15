// --- データ定義 ---
// JSONファイルをインポートする代わりに、データを直接コードに埋め込む
const teamsData = [
    {
        "id": "team_a", "university": "イカ大学", "teamName": "インクリングス",
        "comment": "優勝目指して頑張ります！チーム一丸となって、最高のプレイを見せたいです。応援よろしくお願いします！",
        "teamInfo": "各メンバーの連携力を武器に、安定して前線を押し上げるのが得意なチームです。昨年度の大学対抗戦ではベスト4に入賞しており、今大会でも優勝候補の一角と目されています。",
        "playerInfo": "プレイヤーAはXP3200を超えるチームのエースです。特に近距離での対面性能が非常に高く、相手を圧倒します。\nプレイヤーCは長射程ブキでの正確なエイムが光り、後方からチームを支える重要な役割を担っています。",
        "circleName": "インク研究会", "circleInfo": "週3回、オンラインとオフラインを組み合わせて活動しています。初心者から上級者まで幅広く在籍しており、学内では最大規模のスプラトゥーンサークルです。",
        "p1_name": "プレイヤーA", "p1_xp": "3250", "p1_weapons": "スプラシューター/N-ZAP85/シャープマーカー",
        "p2_name": "プレイヤーB", "p2_xp": "2750", "p2_weapons": "プライムシューター",
        "p3_name": "プレイヤーC", "p3_xp": "2600", "p3_weapons": "リッター4K/スプラスコープ",
        "p4_name": "プレイヤーD", "p4_xp": "2650", "p4_weapons": "スクリュースロッシャー"
    },
    {
        "id": "team_b", "university": "オクト大学", "teamName": "オクトエキスパンションズ",
        "comment": "一戦一戦、楽しんで勝ちにいきます。私たちのユニークな戦術に注目してください。",
        "teamInfo": "メンバー個々の対面能力が非常に高く、どんな状況からでも逆転を狙える攻撃的なチーム編成です。特にガチエリアでの打開力には定評があり、その爆発力は大会屈指です。",
        "playerInfo": "プレイヤーFはXP3300を誇る、チームの司令塔的存在です。広い視野と的確な判断力でチームを勝利に導きます。\nプレイヤーHは塗り性能の高いブキを得意とし、盤面をコントロールする能力に長けています。",
        "circleName": "タコゲーミング", "circleInfo": "プロ選手を複数輩出したこともある、全国でも有名な強豪サークルです。厳しい練習環境で知られています。",
        "p1_name": "プレイヤーE", "p1_xp": "2900", "p1_weapons": "デュアルスイーパーカスタム",
        "p2_name": "プレイヤーF", "p2_xp": "3300", "p2_weapons": "スプラチャージャー/ジェットスイーパー",
        "p3_name": "プレイヤーG", "p3_xp": "2720", "p3_weapons": "ジムワイパー",
        "p4_name": "プレイヤーH", "p4_xp": "2680", "p4_weapons": "LACT-450/プロモデラーRG"
    }
];
const scriptData = [
    { "speaker": "実況", "line": "さあ、始まりました大学杯決勝トーナメント！全国の強豪を勝ち抜いてきた2チームによる、頂上決戦です！" },
    { "speaker": "解説", "line": "今日の注目はやはり、イカ大学のエース、プレイヤーA選手ですね。彼のパフォーマンスが試合の鍵を握るでしょう。" },
    { "speaker": "実況", "line": "XP3200超え、まさに今大会のスタープレイヤーです！対するオクト大学も、チーム全体の練度が非常に高く、一筋縄ではいきません。" },
    { "speaker": "解説", "line": "特にプレイヤーF選手は、長射程ブキを使いこなし、相手チームに大きなプレッシャーを与え続けることができますからね。" }
];


// --- Durable Objectの本体クラス ---
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

// --- エントリーポイント ---
export default {
    async fetch(request, env) {
        let id = env.STATE_MANAGER.idFromName("v1");
        let durableObject = env.STATE_MANAGER.get(id);
        return durableObject.handleHttpRequest(request);
    }
};