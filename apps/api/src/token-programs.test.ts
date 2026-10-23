import { describe, expect, it } from 'vitest';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from './rewards';

describe('token program ids', () => {
  it('match the canonical SPL Token and Token-2022 program addresses', () => {
    expect(TOKEN_PROGRAM_ID).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    // $MART (pump.fun) is a Token-2022 mint.
    expect(TOKEN_2022_PROGRAM_ID).toBe('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
  });
});
