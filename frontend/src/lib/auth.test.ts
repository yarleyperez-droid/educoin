/**
 * Tests de la capa de sesión (T5.3.3, actualizada en T5.4.3 / PRO-381).
 *
 * Verifican que {@link leerSesion} lea correctamente la cookie
 * `educoins_sesion` y devuelva `null` (sin lanzar) ante cualquier entrada
 * inválida — la capa nunca debe tumbar el middleware por una cookie corrupta.
 *
 * Desde T5.4.3 el shape de {@link Sesion} espejea `UsuarioRespuestaDto` del
 * backend: `organizacionId` puede ser `null` (admin) y
 * `debeCambiarContrasena` es obligatorio.
 */

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { crearCookieSesion, leerSesion, type Sesion } from "./auth";

/** Sesión de ejemplo válida para los tests. */
const SESION_EJEMPLO: Sesion = {
  id: "2",
  username: "prof.lopez",
  email: "lopez@educoins.test",
  role: "teacher",
  nombre: "Laura",
  apellido: "García",
  organizacionId: "10",
  debeCambiarContrasena: false,
};

/**
 * Construye un `NextRequest` mínimo con la cookie de sesión dada.
 *
 * @param valor Cookie opcional; si se omite, la petición no lleva la cookie.
 * @returns Petición lista para pasar a {@link leerSesion}.
 */
function peticionConCookie(valor?: string): NextRequest {
  const headers = new Headers();

  if (valor !== undefined) {
    headers.set("cookie", `educoins_sesion=${valor}`);
  }

  return new NextRequest(new URL("http://localhost/teacher"), { headers });
}

describe("leerSesion", () => {
  it("devuelve la sesión con cookie válida y rol teacher", () => {
    const sesion = leerSesion(peticionConCookie(crearCookieSesion(SESION_EJEMPLO)));

    expect(sesion).toEqual(SESION_EJEMPLO);
  });

  it("devuelve la sesión con rol admin y organizacionId null", () => {
    const admin: Sesion = {
      ...SESION_EJEMPLO,
      id: "1",
      username: "admin",
      role: "admin",
      organizacionId: null,
    };
    const sesion = leerSesion(peticionConCookie(crearCookieSesion(admin)));

    expect(sesion?.role).toBe("admin");
    expect(sesion?.organizacionId).toBeNull();
  });

  it("devuelve la sesión con rol student", () => {
    const estudiante: Sesion = { ...SESION_EJEMPLO, role: "student" };
    const sesion = leerSesion(peticionConCookie(crearCookieSesion(estudiante)));

    expect(sesion?.role).toBe("student");
  });

  it("devuelve la sesión con cambio de contraseña pendiente", () => {
    const pendiente: Sesion = {
      ...SESION_EJEMPLO,
      debeCambiarContrasena: true,
    };
    const sesion = leerSesion(peticionConCookie(crearCookieSesion(pendiente)));

    expect(sesion?.debeCambiarContrasena).toBe(true);
  });

  it("soporta Unicode en nombre y apellido (acentos y ñ)", () => {
    const conAcentos: Sesion = {
      ...SESION_EJEMPLO,
      nombre: "José",
      apellido: "Muñoz",
    };
    const sesion = leerSesion(peticionConCookie(crearCookieSesion(conAcentos)));

    expect(sesion?.nombre).toBe("José");
    expect(sesion?.apellido).toBe("Muñoz");
  });

  it("devuelve null sin cookie", () => {
    expect(leerSesion(peticionConCookie())).toBeNull();
  });

  it("devuelve null con cookie basura (no base64) sin lanzar", () => {
    expect(leerSesion(peticionConCookie("esto no es base64 !!!"))).toBeNull();
  });

  it("devuelve null cuando el JSON no es un objeto", () => {
    const valor = btoa(encodeURIComponent(JSON.stringify("cadena")));

    expect(leerSesion(peticionConCookie(valor))).toBeNull();
  });

  it("devuelve null con rol inválido", () => {
    const invalida = { ...SESION_EJEMPLO, role: "hacker" };
    const valor = btoa(encodeURIComponent(JSON.stringify(invalida)));

    expect(leerSesion(peticionConCookie(valor))).toBeNull();
  });

  it("devuelve null cuando faltan campos obligatorios", () => {
    const parcial = { id: "1", role: "teacher" };
    const valor = btoa(encodeURIComponent(JSON.stringify(parcial)));

    expect(leerSesion(peticionConCookie(valor))).toBeNull();
  });

  it("devuelve null cuando organizacionId no es string ni null", () => {
    const invalida = { ...SESION_EJEMPLO, organizacionId: 10 };
    const valor = btoa(encodeURIComponent(JSON.stringify(invalida)));

    expect(leerSesion(peticionConCookie(valor))).toBeNull();
  });

  it("devuelve null cuando falta debeCambiarContrasena", () => {
    const sinFlag: Record<string, unknown> = { ...SESION_EJEMPLO };
    delete sinFlag.debeCambiarContrasena;
    const valor = btoa(encodeURIComponent(JSON.stringify(sinFlag)));

    expect(leerSesion(peticionConCookie(valor))).toBeNull();
  });
});

describe("crearCookieSesion", () => {
  it("genera un valor que leerSesion lee de vuelta (roundtrip)", () => {
    const valor = crearCookieSesion(SESION_EJEMPLO);

    expect(leerSesion(peticionConCookie(valor))).toEqual(SESION_EJEMPLO);
  });
});
