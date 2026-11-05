import { expect, it } from 'vitest';
import { KillChain } from '../server/kill-chain';
it('counts rapid eliminations per killer and expires after four seconds', () => {
 const chain = new KillChain();
 expect(chain.record('a', 0)).toBe(1);
 expect(chain.record('b', 500)).toBe(1);
 expect(chain.record('a', 1000)).toBe(2);
 expect(chain.record('a', 5000)).toBe(3);
 expect(chain.record('a', 9001)).toBe(1);
});
it('resets on death/disconnect and a new match', () => {
 const chain = new KillChain(); chain.record('a', 0); chain.reset('a');
 expect(chain.record('a', 1)).toBe(1);
 chain.clear(); expect(chain.record('a', 2)).toBe(1);
});
