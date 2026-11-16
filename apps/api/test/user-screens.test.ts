import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { effectivePermissions, effectiveScreens } from '../src/modules/auth/screens.js';

describe('usuários com telas definidas', () => {
  it('administrador acessa tudo, inclusive usuários', () => {
    const p = effectivePermissions({ role: 'ADMIN', screens: null });
    assert.ok(p.includes('users:manage'));
    assert.ok(p.includes('integrations:write'));
    assert.ok(effectiveScreens({ role: 'ADMIN', screens: null }).includes('usuarios'));
  });

  it('usuária só da recepção não vê financeiro', () => {
    const u = { role: 'RECEPTIONIST' as const, screens: ['agenda', 'leads'] };
    const p = effectivePermissions(u);
    assert.ok(p.includes('leads:write'));
    assert.ok(p.includes('app:use'));
    assert.ok(!p.includes('finance:read'));
    assert.ok(!p.includes('purchases:read'));
    assert.ok(!p.includes('users:manage'));
    assert.deepEqual(effectiveScreens(u), ['agenda', 'leads']);
  });

  it('só financeiro não acessa leads nem integrações', () => {
    const u = { role: 'RECEPTIONIST' as const, screens: ['financeiro', 'compras'] };
    const p = effectivePermissions(u);
    assert.ok(p.includes('finance:read'));
    assert.ok(p.includes('purchases:write'));
    assert.ok(!p.includes('leads:read'));
    assert.ok(!p.includes('integrations:read'));
  });

  it('telas desconhecidas são ignoradas', () => {
    assert.deepEqual(effectivePermissions({ role: 'RECEPTIONIST', screens: ['xyz'] }), ['app:use']);
  });
});
