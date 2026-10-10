/**
 * Tests de la lógica de redirección del middleware (T5.3.5).
 *
 * Verifican los criterios de aceptación 1 y 2 de H5.3:
 * - CA 1: un rol equivocado en un panel redirige al panel del propio rol.
 * - CA 2: una ruta protegida sin sesión redirige a `/login`.
 *
 * Estos tests validan **UX, no seguridad**: la validación real de rol y
 * propiedad la hace el backend en cada petición. Un usuario que salte el
 * middleware será rechazado por el servidor (CA 4 de H5.3).
 *
 * Se testea la función pura `destinoDeRedireccion` (exportada en T5.3.2) y
 * un caso de integración con `middleware(request)` + cookie simulada.
 */

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { crearCookieSesion, type Sesion } from "@/lib/auth";
import { destinoDeRedireccion, middleware } from "@/middleware";

/** Sesión de ejemplo para los tests de rol equivocado. */
const SESION_ESTUDIANTE: Sesion = {
  userId: "1",
  rol: "student",
  email: "alumno@demo.com",
  nombre: "Ana López",
  organizationId: "10",
};

/** Sesión docente para los tests de rol correcto e integración. */
const SESION_DOCENTE: Sesion = {
  userId: "2",
  rol: "teacher",
  email: "profe@demo.com",
  nombre: "Prof. García",
  organizationId: "10",
};

/** Sesión admin para el test de rol exacto. */
const SESION_ADMIN: Sesion = {
  userId: "3",
  rol: "admin",
  email: "admin@demo.com",
  nombre: "Admin",
  organizationId: "10",
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

describe("integración middleware + cookie simulada", () => {
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
