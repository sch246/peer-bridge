// P2P sanity probe: two in-process PeerConnections + one DataChannel round-trip.
// Uses node-datachannel (N-API binding to libdatachannel). No network, no rendezvous.

import nodeDataChannel from 'node-datachannel';

export async function runProbe(): Promise<{
  handshakeMs: number;
  message: string;
}> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Probe timed out after 10s')), 10_000);

    const startTime = Date.now();

    // ── Cleanup ──
    let peer1: nodeDataChannel.PeerConnection | null = null;
    let peer2: nodeDataChannel.PeerConnection | null = null;
    let dc1: nodeDataChannel.DataChannel | null = null;
    let dc2: nodeDataChannel.DataChannel | null = null;

    const cleanup = () => {
      clearTimeout(timeout);
      try {
        dc1?.close();
      } catch {
        /* best-effort */
      }
      try {
        dc2?.close();
      } catch {
        /* best-effort */
      }
      try {
        peer1?.close();
      } catch {
        /* best-effort */
      }
      try {
        peer2?.close();
      } catch {
        /* best-effort */
      }
    };

    // ── Peer 1 (Alice - offerer) ──
    peer1 = new nodeDataChannel.PeerConnection('Alice', {
      iceServers: [],
    });

    // ── Peer 2 (Bob - answerer) ──
    peer2 = new nodeDataChannel.PeerConnection('Bob', {
      iceServers: [],
    });

    // ── SDP/ICE relay (in-process) ──
    peer1.onLocalDescription((sdp, type) => {
      peer2!.setRemoteDescription(sdp, type);
    });
    peer1.onLocalCandidate((candidate, mid) => {
      peer2!.addRemoteCandidate(candidate, mid);
    });

    peer2.onLocalDescription((sdp, type) => {
      peer1!.setRemoteDescription(sdp, type);
    });
    peer2.onLocalCandidate((candidate, mid) => {
      peer1!.addRemoteCandidate(candidate, mid);
    });

    // ── Bob receives the DataChannel ──
    let handshakeMs: number | null = null;

    peer2.onDataChannel((dc) => {
      dc2 = dc;
      dc2.onMessage((msg) => {
        handshakeMs = Date.now() - startTime;
        cleanup();
        resolve({ handshakeMs, message: String(msg) });
      });
      // Also set up dc2.onOpen if we want to be explicit, but the README
      // example sends/receives without an explicit onOpen on the answer side.
      // onDataChannel fires during negotiation; onMessage fires after open.
    });

    // ── Alice creates DataChannel ──
    dc1 = peer1.createDataChannel('control');

    dc1.onOpen(() => {
      dc1!.sendMessage('hello from alice');
    });

    // Race guard: if cleanup resolves, this is harmless.
    // If neither onOpen nor onMessage fires within 10s, timeout rejects.
  });
}
