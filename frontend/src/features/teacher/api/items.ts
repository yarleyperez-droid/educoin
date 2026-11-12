/**
 * Fachada del catálogo de ítems del profesor (tienda de canjes, H10.2 /
 * T10.2.1–T10.2.2).
 *
 * Punto único entre la vista `app/teacher/canjes` y el transporte
 * (`@/lib/api-client`). Habla con la API real de H4.1
 * (`src/modules/items/items.controller.ts`), verificada antes de escribir
 * esta fachada (AGENTS.md §10.2):
 *
 * - `GET /api/v1/items?classId=…` (`@Roles('teacher','student')`) →
 *   `ItemDto[]` **en plano** (sin envoltura): `apiPlano.get`. Para el
 *   profesor devuelve `active` e `inactive` de SU clase (nunca `deleted`).
 * - `POST /api/v1/items` (`@Roles('teacher')`) → `ItemDto` en plano (201).
 * - `PATCH /api/v1/items/:id` → `ItemDto` en plano (200); el merge
 *   resultante se revalida en el backend (422 si queda inválido por tipo).
 * - `DELETE /api/v1/items/:id` → `ItemDto` en plano (200): borrado
 *   **lógico** (`status = 'deleted'`); el histórico de canjes no se toca.
 *
 * La validación del formulario se hace **aquí** (doble validación,
 * AGENTS.md §6) con los mismos textos que el backend, para que el error
 * aparezca sin ida y vuelta; el backend vuelve a validar por su parte y
 * sus mensajes (`ApiError.message`) también se muestran tal cual. La regla
 * de décimas 0.1–0.5 es la de **H10.1** (`evaluarItemPorTipo` +
 * `ck_item_grade_points_rango`): no se duplica ninguna regla nueva.
 */

import { ApiError, apiPlano } from "@/lib/api-client";

/** Tipo de ítem canjeable (`item_type` de la BD). */
export type TipoItem = "grade_bonus" | "fun_activity";

/** Estados editables que devuelve el listado (el `deleted` no vuelve). */
export type EstadoItem = "active" | "inactive";

/** Máximo de caracteres del nombre (`VARCHAR(150)` de la BD). */
export const LONGITUD_MAXIMA_NOMBRE = 150;

/** Mínimo de décimas de un bono de nota (H10.1). */
export const DECIMAS_MINIMAS = 0.1;

/** Máximo de décimas de un bono de nota (H10.1). */
export const DECIMAS_MAXIMAS = 0.5;

/** Opciones válidas del selector de décimas (una décima de granularidad). */
export const OPCIONES_DECIMAS = [0.1, 0.2, 0.3, 0.4, 0.5] as const;

/** Mensajes de validación (mismas reglas que el backend, en español). */
export const MENSAJES_ITEM = {
  nombreVacio: "El nombre del artículo es obligatorio.",
  nombreLargo: "El nombre del artículo no puede superar los 150 caracteres.",
  costoInvalido: "El costo en EduCoins debe ser un entero mayor que 0.",
  decimasRequeridas: "Ingresa las décimas del bono de nota (0.1 a 0.5).",
  decimasFueraRango:
    "Los puntos de nota (grade_points) deben estar entre 0.1 y 0.5 décimas.",
  stockRequerido: "La actividad lúdica (fun_activity) requiere un stock.",
  stockInvalido: "El stock de la actividad lúdica no puede ser negativo.",
  tipoIncompatible:
    "La actividad lúdica (fun_activity) no admite grade_points.",
} as const;

/**
 * Ítem del catálogo tal y como sale del `ItemDto` del backend (H4.1),
 * con el vocabulario del frontend (`classId → claseId`).
 */
export interface ItemTienda {
  /** ID del ítem (BigInt de la BD como string). */
  id: string;

  /** Clase dueña del ítem (FK `redeemable_items.class_id`). */
  claseId: string;

  /** Nombre visible (VARCHAR(150), único por clase). */
  name: string;

  /** Texto descriptivo opcional. */
  description: string | null;

  /** `grade_bonus` (bono de nota) o `fun_activity` (actividad lúdica). */
  type: TipoItem;

  /** Costo en EduCoins (entero > 0). */
  costCoins: number;

  /** Décimas de nota (0.1–0.5, H10.1); solo `grade_bonus`. */
  gradePoints: number | null;

  /** Existencias (entero ≥ 0); solo `fun_activity`. */
  stock: number | null;

  /** `active` o `inactive` (el listado nunca devuelve `deleted`). */
  status: EstadoItem;

  /** `true` ⇒ el canje se aprueba solo (H7.2, política del ítem). */
  autoApprove: boolean;

  /** Fecha de creación (ISO). */
  creadoEn: string;

  /** Fecha de la última modificación (ISO). */
  actualizadoEn: string;
}

/** `ItemDto` crudo del backend (camelCase, `classId` incluido). */
interface ItemBackend {
  id: string;
  classId: string;
  name: string;
  description: string | null;
  type: TipoItem;
  costCoins: number;
  gradePoints: number | null;
  stock: number | null;
  status: string;
  autoApprove: boolean;
  creadoEn: string;
  actualizadoEn: string;
}

/** Datos del formulario (alta), ya normalizados por la vista. */
export interface DatosNuevoItem {
  name: string;
  description: string | null;
  type: TipoItem;
  costCoins: number;
  /** Solo `grade_bonus`; `null` en `fun_activity`. */
  gradePoints: number | null;
  /** Solo `fun_activity`; `null` en `grade_bonus`. */
  stock: number | null;
  autoApprove: boolean;
}

/** Parche de edición (los campos que el formulario permite cambiar). */
export interface ParcheItem {
  name?: string;
  description?: string | null;
  costCoins?: number;
  gradePoints?: number | null;
  stock?: number | null;
  autoApprove?: boolean;
}

/** Clase asignada al ítem: el backend no la permite cambiar (H4.1). */
function aItem(backend: ItemBackend): ItemTienda {
  return {
    id: String(backend.id),
    claseId: String(backend.classId),
    name: backend.name,
    description: backend.description,
    type: backend.type,
    costCoins: Number(backend.costCoins),
    gradePoints:
      backend.gradePoints === null || backend.gradePoints === undefined
        ? null
        : Number(backend.gradePoints),
    stock: backend.stock === null ? null : Number(backend.stock),
    status: backend.status as EstadoItem,
    autoApprove: backend.autoApprove,
    creadoEn: backend.creadoEn,
    actualizadoEn: backend.actualizadoEn,
  };
}

/**
 * Valida los campos **comunes** del formulario: nombre y costo.
 *
 * Exportada para que la vista (`tienda-clase.tsx`) reutilice la misma
 * validación antes de llamar a `crearItem`/`actualizarItem` (doble
 * validación, AGENTS.md §6).
 *
 * @param datos Datos del ítem a validar (parcial o completo).
 * @returns Lista de errores (vacía si todo cumple).
 */
export function erroresComunes(datos: {
  name: string;
  costCoins: number;
}): string[] {
  const errores: string[] = [];
  const nombre = datos.name.trim();

  if (nombre === "") {
    errores.push(MENSAJES_ITEM.nombreVacio);
  } else if (nombre.length > LONGITUD_MAXIMA_NOMBRE) {
    errores.push(MENSAJES_ITEM.nombreLargo);
  }

  if (!Number.isInteger(datos.costCoins) || datos.costCoins <= 0) {
    errores.push(MENSAJES_ITEM.costoInvalido);
  }

  return errores;
}

/**
 * Valida la **composición por tipo** (espejo de `evaluarItemPorTipo`,
 * H4.1 + el rango 0.1–0.5 de H10.1):
 *
 * - `grade_bonus`: exige décimas dentro de 0.1–0.5 y prohíbe `stock`.
 * - `fun_activity`: exige `stock` entero ≥ 0 y prohíbe `gradePoints`.
 *
 * @param type Tipo del ítem (no cambia en caliente).
 * @param gradePoints Décimas propuestas.
 * @param stock Existencias propuestas.
 * @returns Lista de errores (vacía si todo cumple).
 */
export function erroresPorTipo(
  type: TipoItem,
  gradePoints: number | null,
  stock: number | null,
): string[] {
  const errores: string[] = [];

  if (type === "grade_bonus") {
    if (gradePoints === null) {
      errores.push(MENSAJES_ITEM.decimasRequeridas);
    } else if (!(gradePoints >= DECIMAS_MINIMAS && gradePoints <= DECIMAS_MAXIMAS)) {
      errores.push(MENSAJES_ITEM.decimasFueraRango);
    }
    if (stock !== null) {
      errores.push(MENSAJES_ITEM.tipoIncompatible);
    }
    return errores;
  }

  if (stock === null) {
    errores.push(MENSAJES_ITEM.stockRequerido);
  } else if (!Number.isInteger(stock) || stock < 0) {
    errores.push(MENSAJES_ITEM.stockInvalido);
  }
  if (gradePoints !== null) {
    errores.push(MENSAJES_ITEM.tipoIncompatible);
  }

  return errores;
}

/**
 * Lista los ítems de una clase del profesor (`GET /items?classId=…`).
 *
 * El backend responde `ItemDto[]` en plano con `active` e `inactive`
 * (los `deleted` quedan fuera del listado): la vista muestra los activos
 * y los archivados con su badge (CA 1 de H10.2).
 *
 * @param claseId Clase cuyos artículos se listan.
 * @returns Los ítems en orden de alta.
 * @throws {ApiError} 403 si la clase es ajena o inexistente (mensaje
 *   uniforme del backend: "No puedes administrar ítems de esta clase.").
 */
export async function listarItemsClase(
  claseId: string,
): Promise<ItemTienda[]> {
  const filas = await apiPlano.get<ItemBackend[]>(
    `items?classId=${encodeURIComponent(claseId)}`,
  );

  return filas.map(aItem);
}

/**
 * Publica un artículo en la clase (`POST /items`, CA 2 de H10.2).
 *
 * Valida primero con las mismas reglas del backend (`CrearItemDto` +
 * H10.1): nombre 1–150 tras `trim`, costo entero > 0 y composición por
 * tipo. El `classId` viaja en el body (el backend verifica pertenencia →
 * 403 uniforme si la clase es ajena).
 *
 * @param claseId Clase donde se publica.
 * @param datos Datos del formulario ya elegidos por el profesor.
 * @returns El ítem creado (con `status: 'active'`).
 * @throws {ApiError} 422 con `message` uniendo los errores de validación,
 *   o los 400/403/409 del backend con su mensaje en español.
 */
export async function crearItem(
  claseId: string,
  datos: DatosNuevoItem,
): Promise<ItemTienda> {
  const errores = [
    ...erroresComunes(datos),
    ...erroresPorTipo(datos.type, datos.gradePoints, datos.stock),
  ];

  if (errores.length > 0) {
    throw new ApiError(errores.join(" "), 422);
  }

  return aItem(
    await apiPlano.post<ItemBackend>("items", {
      classId: Number(claseId),
      name: datos.name.trim(),
      description: datos.description,
      type: datos.type,
      costCoins: datos.costCoins,
      ...(datos.type === "grade_bonus"
        ? { gradePoints: datos.gradePoints }
        : { stock: datos.stock }),
      autoApprove: datos.autoApprove,
    }),
  );
}

/**
 * Edita un artículo (`PATCH /items/:id`).
 *
 * Envía solo los campos cambiados; el backend revalida el **merge** con
 * el ítem guardado (422 si el resultado queda inválido por tipo o el
 * nombre choca con otro de la misma clase → 409). El `type` y la clase
 * **no** son editables (supuesto de H4.1).
 *
 * @param id Id del ítem.
 * @param parche Campos a cambiar ya validados por el formulario.
 * @returns El ítem actualizado.
 * @throws {ApiError} 400/403/409/422 del backend con su mensaje en
 *   español.
 */
export async function actualizarItem(
  id: string,
  parche: ParcheItem,
): Promise<ItemTienda> {
  return aItem(
    await apiPlano.patch<ItemBackend>(`items/${encodeURIComponent(id)}`, {
      ...(parche.name !== undefined && { name: parche.name.trim() }),
      ...(parche.description !== undefined && {
        description: parche.description,
      }),
      ...(parche.costCoins !== undefined && { costCoins: parche.costCoins }),
      ...(parche.gradePoints !== undefined && {
        gradePoints: parche.gradePoints,
      }),
      ...(parche.stock !== undefined && { stock: parche.stock }),
      ...(parche.autoApprove !== undefined && {
        autoApprove: parche.autoApprove,
      }),
    }),
  );
}

/**
 * Archiva un artículo (`DELETE /items/:id`): borrado **lógico** del
 * backend (`status = 'deleted'`), idempotente; el histórico de canjes no
 * se toca y el ítem desaparece de la tienda (CA 3 de H10.2).
 *
 * @param id Id del ítem.
 * @returns El ítem con `status: 'deleted'`.
 * @throws {ApiError} 403 si el ítem es ajeno, con el mensaje uniforme del
 *   backend.
 */
export async function archivarItem(id: string): Promise<ItemTienda> {
  return aItem(
    await apiPlano.delete<ItemBackend>(`items/${encodeURIComponent(id)}`),
  );
}
