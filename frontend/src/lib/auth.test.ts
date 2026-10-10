/**
 * Tests de la capa de sesión simulada (T5.3.3).
 *
 * Verifican que {@link leerSesion} lea correctamente la cookie simulada
 * `educoins_sesion` y devuelva `null` (sin lanzar) ante cualquier entrada
 * inválida — la capa nunca debe tumbar el middleware por una cookie corrupta.
 */

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { crearCookieSesion, leerSesion, type Sesion } from "./auth";

/** Sesión de ejemplo válida para los tests. */
const SESION_EJEMPLO: Sesion = {
  userId: "1",
  rol: "teacher",
  email: "profe@demo.com",
  nombre: "Prof. García",
  organizationId: "10",
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

  it("devuelve la sesión con rol admin", () => {
    const admin: Sesion = { ...SESION_EJEMPLO, rol: "admin" };
    const sesion = leerSesion(peticionConCookie(crearCookieSesion(admin)));

    expect(sesion?.rol).toBe("admin");
  });

  it("devuelve la sesión con rol student", () => {
    const estudiante: Sesion = { ...SESION_EJEMPLO, rol: "student" };
    const sesion = leerSesion(peticionConCookie(crearCookieSesion(estudiante)));

    expect(sesion?.rol).toBe("student");
  });

  it("soporta Unicode en el nombre (acentos y ñ)", () => {
    const conAcentos: Sesion = { ...SESION_EJEMPLO, nombre: "José Muñoz" };
    const sesion = leerSesion(peticionConCookie(crearCookieSesion(conAcentos)));

    expect(sesion?.nombre).toBe("José Muñoz");
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
    const invalida = { ...SESION_EJEMPLO, rol: "hacker" };
    const valor = btoa(encodeURIComponent(JSON.stringify(invalida)));

    expect(leerSesion(peticionConCookie(valor))).toBeNull();
  });

  it("devuelve null cuando faltan campos obligatorios", () => {
    const parcial = { userId: "1", rol: "teacher" };
    const valor = btoa(encodeURIComponent(JSON.stringify(parcial)));

    expect(leerSesion(peticionConCookie(valor))).toBeNull();
  });
});

describe("crearCookieSesion", () => {
  it("genera un valor que leerSesion lee de vuelta (roundtrip)", () => {
    const valor = crearCookieSesion(SESION_EJEMPLO);

    expect(leerSesion(peticionConCookie(valor))).toEqual(SESION_EJEMPLO);
  });
});
