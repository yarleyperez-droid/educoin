/**
 * Tests de la lógica de redirección del middleware (T5.3.5).
 *
 * Verifican los criterios de aceptación 1 y 2 de H5.3:
 * - CA 1: un rol equivocado en un panel redirige al panel del propio rol.
 * - CA 2: una ruta protegida sin sesión redirige a `/login`.
 *
 * T5.4.2 (PRO-379) añade los escenarios del bloqueo por
 * `debeCambiarContrasena` (plan §5), su anti-loops y la integración con la
 * cookie que lleva el flag. Desde T5.4.3 (PRO-381) el flag y el rol usan el
 * vocabulario del backend (`role`, `debeCambiarContrasena`).
 *
 * Estos tests validan **UX, no seguridad**: la validación real de rol y
 * propiedad la hace el backend en cada petición. Un usuario que salte el
 * middleware será rechazado por el servidor (CA 4 de H5.3).
 *
 * Se testea la función pura `destinoDeRedireccion` (exportada en T5.3.2) y
 * un caso de integración con `middleware(request)` + cookie de sesión.
 */

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { crearCookieSesion, type Sesion } from "@/lib/auth";
import { destinoDeRedireccion, middleware } from "@/middleware";

/** Sesión de ejemplo para los tests de rol equivocado. */
const SESION_ESTUDIANTE: Sesion = {
  id: "3",
  username: "est.perez",
  email: "perez@educoins.test",
  role: "student",
  nombre: "Ana",
  apellido: "López",
  organizacionId: "10",
  debeCambiarContrasena: false,
};

/** Sesión docente para los tests de rol correcto e integración. */
const SESION_DOCENTE: Sesion = {
  id: "2",
  username: "prof.lopez",
  email: "lopez@educoins.test",
  role: "teacher",
  nombre: "Laura",
  apellido: "García",
  organizacionId: "10",
  debeCambiarContrasena: false,
};

/** Sesión admin para el test de rol exacto (sin organización). */
const SESION_ADMIN: Sesion = {
  id: "1",
  username: "admin",
  email: "admin@educoins.test",
  role: "admin",
  nombre: "Admin",
  apellido: "EduCoins",
  organizacionId: null,
  debeCambiarContrasena: false,
};

/** Sesión estudiante con cambio de contraseña pendiente (T5.4.2). */
const SESION_ESTUDIANTE_CON_CAMBIO_PENDIENTE: Sesion = {
  ...SESION_ESTUDIANTE,
  debeCambiarContrasena: true,
};

/** Sesión estudiante que ya resolvió el cambio obligatorio (T5.4.2). */
const SESION_ESTUDIANTE_SIN_CAMBIO_PENDIENTE: Sesion = {
  ...SESION_ESTUDIANTE,
  debeCambiarContrasena: false,
};

describe("destinoDeRedireccion — rol equivocado (CA 1)", () => {
  it("estudiante en /teacher redirige a /student", () => {
    expect(destinoDeRedireccion("/teacher", SESION_ESTUDIANTE)).toBe(
      "/student",
    );
  });

  it("docente en /student redirige a /teacher", () => {
    expect(destinoDeRedireccion("/student", SESION_DOCENTE)).toBe("/teacher");
  });

  it("admin en /teacher redirige a /admin", () => {
    expect(destinoDeRedireccion("/teacher", SESION_ADMIN)).toBe("/admin");
  });

  it("subruta /teacher/actividades con rol equivocado también redirige", () => {
    expect(destinoDeRedireccion("/teacher/actividades", SESION_ESTUDIANTE)).toBe(
      "/student",
    );
  });
});

describe("destinoDeRedireccion — sin sesión (CA 2)", () => {
  it("/teacher sin sesión redirige a /login", () => {
    expect(destinoDeRedireccion("/teacher", null)).toBe("/login");
  });

  it("/student sin sesión redirige a /login", () => {
    expect(destinoDeRedireccion("/student", null)).toBe("/login");
  });

  it("/admin sin sesión redirige a /login", () => {
    expect(destinoDeRedireccion("/admin", null)).toBe("/login");
  });
});

describe("destinoDeRedireccion — rol correcto", () => {
  it("docente en /teacher no redirige", () => {
    expect(destinoDeRedireccion("/teacher", SESION_DOCENTE)).toBeNull();
  });

  it("estudiante en /student no redirige", () => {
    expect(destinoDeRedireccion("/student", SESION_ESTUDIANTE)).toBeNull();
  });

  it("admin en /admin no redirige", () => {
    expect(destinoDeRedireccion("/admin", SESION_ADMIN)).toBeNull();
  });
});

describe("destinoDeRedireccion — /login", () => {
  it("login con sesión de docente redirige a /teacher", () => {
    expect(destinoDeRedireccion("/login", SESION_DOCENTE)).toBe("/teacher");
  });

  it("login con sesión de estudiante redirige a /student", () => {
    expect(destinoDeRedireccion("/login", SESION_ESTUDIANTE)).toBe("/student");
  });

  it("login con sesión de admin redirige a /admin", () => {
    expect(destinoDeRedireccion("/login", SESION_ADMIN)).toBe("/admin");
  });

  it("login sin sesión no redirige", () => {
    expect(destinoDeRedireccion("/login", null)).toBeNull();
  });
});

describe("destinoDeRedireccion — rutas públicas", () => {
  it("ruta raíz con sesión no redirige", () => {
    expect(destinoDeRedireccion("/", SESION_ESTUDIANTE)).toBeNull();
  });
});

describe("integración middleware + cookie de sesión", () => {
  it("redirige a /student cuando la cookie indica rol student y se pide /teacher", () => {
    const cookie = crearCookieSesion(SESION_ESTUDIANTE);
    const request = new NextRequest(new URL("http://localhost/teacher"), {
      headers: new Headers({ cookie: `educoins_sesion=${cookie}` }),
    });

    const response = middleware(request);
    const ubicacion = response.headers.get("location");

    expect(ubicacion).toContain("/student");
  });

  it("deja pasar cuando la cookie coincide con el rol de la ruta", () => {
    const cookie = crearCookieSesion(SESION_DOCENTE);
    const request = new NextRequest(new URL("http://localhost/teacher"), {
      headers: new Headers({ cookie: `educoins_sesion=${cookie}` }),
    });

    const response = middleware(request);
    const ubicacion = response.headers.get("location");

    expect(ubicacion).toBeNull();
  });
});

describe("destinoDeRedireccion — cambio obligatorio de contraseña (T5.4.2)", () => {
  it("flag true + /student redirige a /cambiar-contrasena", () => {
    expect(
      destinoDeRedireccion("/student", SESION_ESTUDIANTE_CON_CAMBIO_PENDIENTE),
    ).toBe("/cambiar-contrasena");
  });

  it("flag true + /login redirige a /cambiar-contrasena (ya hizo login)", () => {
    expect(
      destinoDeRedireccion("/login", SESION_ESTUDIANTE_CON_CAMBIO_PENDIENTE),
    ).toBe("/cambiar-contrasena");
  });

  it("flag false + /cambiar-contrasena redirige al panel del rol", () => {
    expect(
      destinoDeRedireccion(
        "/cambiar-contrasena",
        SESION_ESTUDIANTE_SIN_CAMBIO_PENDIENTE,
      ),
    ).toBe("/student");
  });

  it("flag false + panel del rol correcto deja pasar", () => {
    expect(
      destinoDeRedireccion("/student", SESION_ESTUDIANTE_SIN_CAMBIO_PENDIENTE),
    ).toBeNull();
  });

  it("sesión sin cambio pendiente entra a /cambiar-contrasena solo vía redirección", () => {
    // Flag en false: el cambio se resuelve al panel del rol…
    expect(destinoDeRedireccion("/cambiar-contrasena", SESION_ESTUDIANTE)).toBe(
      "/student",
    );

    // …y su panel sigue funcionando como hasta ahora.
    expect(destinoDeRedireccion("/student", SESION_ESTUDIANTE)).toBeNull();
  });
});

describe("destinoDeRedireccion — anti-loops del cambio obligatorio (T5.4.2)", () => {
  it("flag true + /cambiar-contrasena deja pasar (sin bucle)", () => {
    expect(
      destinoDeRedireccion(
        "/cambiar-contrasena",
        SESION_ESTUDIANTE_CON_CAMBIO_PENDIENTE,
      ),
    ).toBeNull();
  });

  it("sin sesión + /cambiar-contrasena redirige a /login", () => {
    expect(destinoDeRedireccion("/cambiar-contrasena", null)).toBe("/login");
  });

  it("cada destino de redirección se cumple en un solo salto", () => {
    // flag true → cambio → pasa.
    const trasCambio = destinoDeRedireccion(
      "/cambiar-contrasena",
      SESION_ESTUDIANTE_CON_CAMBIO_PENDIENTE,
    );
    expect(trasCambio).toBeNull();

    // flag false → panel → pasa.
    const trasPanel = destinoDeRedireccion(
      "/student",
      SESION_ESTUDIANTE_SIN_CAMBIO_PENDIENTE,
    );
    expect(trasPanel).toBeNull();

    // Sin sesión → login → pasa.
    expect(destinoDeRedireccion("/login", null)).toBeNull();
  });
});

describe("integración middleware + cookie con flag de cambio (T5.4.2)", () => {
  it("cookie con debeCambiarContrasena true redirige a /cambiar-contrasena desde el panel", () => {
    const cookie = crearCookieSesion(SESION_ESTUDIANTE_CON_CAMBIO_PENDIENTE);
    const request = new NextRequest(new URL("http://localhost/student"), {
      headers: new Headers({ cookie: `educoins_sesion=${cookie}` }),
    });

    const response = middleware(request);
    const ubicacion = response.headers.get("location");

    expect(ubicacion).toContain("/cambiar-contrasena");
  });

  it("cookie con el flag en false deja pasar /cambiar-contrasena al panel del rol", () => {
    const cookie = crearCookieSesion(SESION_ESTUDIANTE_SIN_CAMBIO_PENDIENTE);
    const request = new NextRequest(
      new URL("http://localhost/cambiar-contrasena"),
      {
        headers: new Headers({ cookie: `educoins_sesion=${cookie}` }),
      },
    );

    const response = middleware(request);
    const ubicacion = response.headers.get("location");

    expect(ubicacion).toContain("/student");
  });
});
