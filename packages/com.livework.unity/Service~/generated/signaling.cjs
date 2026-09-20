var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// upstream/websockethandler.ts
var websockethandler_exports = {};
__export(websockethandler_exports, {
  add: () => add,
  onAnswer: () => onAnswer,
  onCandidate: () => onCandidate,
  onConnect: () => onConnect,
  onDisconnect: () => onDisconnect,
  onOffer: () => onOffer,
  remove: () => remove,
  reset: () => reset
});
module.exports = __toCommonJS(websockethandler_exports);

// upstream/offer.ts
var Offer = class {
  sdp;
  datetime;
  polite;
  constructor(sdp, datetime, polite) {
    this.sdp = sdp;
    this.datetime = datetime;
    this.polite = polite;
  }
};

// upstream/answer.ts
var Answer = class {
  sdp;
  datetime;
  constructor(sdp, datetime) {
    this.sdp = sdp;
    this.datetime = datetime;
  }
};

// upstream/candidate.ts
var Candidate = class {
  candidate;
  sdpMLineIndex;
  sdpMid;
  datetime;
  constructor(candidate, sdpMLineIndex, sdpMid, datetime) {
    this.candidate = candidate;
    this.sdpMLineIndex = sdpMLineIndex;
    this.sdpMid = sdpMid;
    this.datetime = datetime;
  }
};

// upstream/websockethandler.ts
var isPrivate;
var clients = /* @__PURE__ */ new Map();
var connectionPair = /* @__PURE__ */ new Map();
function getOrCreateConnectionIds(session) {
  let connectionIds = null;
  if (!clients.has(session)) {
    connectionIds = /* @__PURE__ */ new Set();
    clients.set(session, connectionIds);
  }
  connectionIds = clients.get(session);
  return connectionIds;
}
function reset(mode) {
  isPrivate = mode == "private";
}
function add(ws) {
  clients.set(ws, /* @__PURE__ */ new Set());
}
function remove(ws) {
  const connectionIds = clients.get(ws);
  connectionIds.forEach((connectionId) => {
    const pair = connectionPair.get(connectionId);
    if (pair) {
      const otherSessionWs = pair[0] == ws ? pair[1] : pair[0];
      if (otherSessionWs) {
        otherSessionWs.send(JSON.stringify({ type: "disconnect", connectionId }));
      }
    }
    connectionPair.delete(connectionId);
  });
  clients.delete(ws);
}
function onConnect(ws, connectionId) {
  let polite = true;
  if (isPrivate) {
    if (connectionPair.has(connectionId)) {
      const pair = connectionPair.get(connectionId);
      if (pair[0] != null && pair[1] != null) {
        ws.send(JSON.stringify({ type: "error", message: `${connectionId}: This connection id is already used.` }));
        return;
      } else if (pair[0] != null) {
        connectionPair.set(connectionId, [pair[0], ws]);
      }
    } else {
      connectionPair.set(connectionId, [ws, null]);
      polite = false;
    }
  }
  const connectionIds = getOrCreateConnectionIds(ws);
  connectionIds.add(connectionId);
  ws.send(JSON.stringify({ type: "connect", connectionId, polite }));
}
function onDisconnect(ws, connectionId) {
  const connectionIds = clients.get(ws);
  connectionIds.delete(connectionId);
  if (connectionPair.has(connectionId)) {
    const pair = connectionPair.get(connectionId);
    const otherSessionWs = pair[0] == ws ? pair[1] : pair[0];
    if (otherSessionWs) {
      otherSessionWs.send(JSON.stringify({ type: "disconnect", connectionId }));
    }
  }
  connectionPair.delete(connectionId);
  ws.send(JSON.stringify({ type: "disconnect", connectionId }));
}
function onOffer(ws, message) {
  const connectionId = message.connectionId;
  const newOffer = new Offer(message.sdp, Date.now(), false);
  if (isPrivate) {
    if (connectionPair.has(connectionId)) {
      const pair = connectionPair.get(connectionId);
      const otherSessionWs = pair[0] == ws ? pair[1] : pair[0];
      if (otherSessionWs) {
        newOffer.polite = true;
        otherSessionWs.send(JSON.stringify({ from: connectionId, to: "", type: "offer", data: newOffer }));
      }
    }
    return;
  }
  connectionPair.set(connectionId, [ws, null]);
  clients.forEach((_v, k) => {
    if (k == ws) {
      return;
    }
    k.send(JSON.stringify({ from: connectionId, to: "", type: "offer", data: newOffer }));
  });
}
function onAnswer(ws, message) {
  const connectionId = message.connectionId;
  const connectionIds = getOrCreateConnectionIds(ws);
  connectionIds.add(connectionId);
  const newAnswer = new Answer(message.sdp, Date.now());
  if (!connectionPair.has(connectionId)) {
    return;
  }
  const pair = connectionPair.get(connectionId);
  const otherSessionWs = pair[0] == ws ? pair[1] : pair[0];
  if (!isPrivate) {
    connectionPair.set(connectionId, [otherSessionWs, ws]);
  }
  otherSessionWs.send(JSON.stringify({ from: connectionId, to: "", type: "answer", data: newAnswer }));
}
function onCandidate(ws, message) {
  const connectionId = message.connectionId;
  const candidate = new Candidate(message.candidate, message.sdpMLineIndex, message.sdpMid, Date.now());
  if (isPrivate) {
    if (connectionPair.has(connectionId)) {
      const pair = connectionPair.get(connectionId);
      const otherSessionWs = pair[0] == ws ? pair[1] : pair[0];
      if (otherSessionWs) {
        otherSessionWs.send(JSON.stringify({ from: connectionId, to: "", type: "candidate", data: candidate }));
      }
    }
    return;
  }
  clients.forEach((_v, k) => {
    if (k === ws) {
      return;
    }
    k.send(JSON.stringify({ from: connectionId, to: "", type: "candidate", data: candidate }));
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  add,
  onAnswer,
  onCandidate,
  onConnect,
  onDisconnect,
  onOffer,
  remove,
  reset
});
