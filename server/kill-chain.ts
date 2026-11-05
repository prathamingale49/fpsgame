export class KillChain {
  private chains = new Map<string, { at: number; count: number }>();
  record(id: string, now: number): number {
    const last = this.chains.get(id);
    const count = last && now - last.at <= 4000 ? last.count + 1 : 1;
    this.chains.set(id, { at: now, count });
    return count;
  }
  reset(id: string) { this.chains.delete(id); }
  clear() { this.chains.clear(); }
}
