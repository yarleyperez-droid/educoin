// PR DE PRUEBA (T6.4.3 / PRO-417): error intencional para verificar que el
// CI queda en rojo. Este archivo NO se fusiona.
describe('CI rojo (prueba intencional)', () => {
  it('falla a propósito', () => {
    expect(1).toBe(2);
  });
});
