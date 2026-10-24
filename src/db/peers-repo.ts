import type { Db } from "./client";

/** Competidores de cada valor y la propuesta de la IA que los originó (CLAUDE.md §4.3). */

export type PeerSource = "ai-validated" | "user";

export interface PeerRow {
  peer_id: number;
  ticker: string;
  name: string;
  source: PeerSource;
  reason: string | null;
  in_watchlist: number;
}

export function listPeers(db: Db, securityId: number): Promise<PeerRow[]> {
  return db.select<PeerRow>(
    `SELECT p.peer_id, s.ticker, s.name, p.source, p.reason, s.in_watchlist
     FROM peers p JOIN securities s ON s.id = p.peer_id
     WHERE p.security_id = ? ORDER BY p.created_at, s.ticker`,
    [securityId],
  );
}

export async function addPeer(db: Db, securityId: number, peerId: number, source: PeerSource, reason: string | null): Promise<void> {
  await db.execute(
    `INSERT INTO peers (security_id, peer_id, source, reason, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (security_id, peer_id) DO UPDATE SET reason = COALESCE(peers.reason, excluded.reason)`,
    [securityId, peerId, source, reason, new Date().toISOString()],
  );
}

export async function removePeer(db: Db, securityId: number, peerId: number): Promise<void> {
  await db.execute("DELETE FROM peers WHERE security_id = ? AND peer_id = ?", [securityId, peerId]);
}

export interface PeerProposalRow {
  security_id: number;
  model: string;
  prompt_version: string;
  result_json: string;
  cost_eur: number | null;
  created_at: string;
}

export async function getPeerProposal(db: Db, securityId: number): Promise<PeerProposalRow | null> {
  const rows = await db.select<PeerProposalRow>(
    "SELECT security_id, model, prompt_version, result_json, cost_eur, created_at FROM peer_proposals WHERE security_id = ?",
    [securityId],
  );
  return rows[0] ?? null;
}

export async function savePeerProposal(db: Db, p: Omit<PeerProposalRow, "created_at">): Promise<void> {
  await db.execute(
    `INSERT INTO peer_proposals (security_id, model, prompt_version, result_json, cost_eur, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (security_id) DO UPDATE SET model = excluded.model, prompt_version = excluded.prompt_version,
       result_json = excluded.result_json, cost_eur = excluded.cost_eur, created_at = excluded.created_at`,
    [p.security_id, p.model, p.prompt_version, p.result_json, p.cost_eur, new Date().toISOString()],
  );
}
