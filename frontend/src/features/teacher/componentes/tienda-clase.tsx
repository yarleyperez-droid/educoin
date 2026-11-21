/**
 * Tienda de artículos de la clase del profesor — H10.2 (T10.2.1–T10.2.3).
 *
 * Pestaña "Tienda" de `/teacher/canjes`: selector de las clases del
 * profesor (`GET /classes` sin `q`, fachada `listarMisClases` de H3.1),
 * listado de los artículos de la clase elegida con su estado, costo y
 * décimas (`GET /items?classId=…`, fachada H4.1) y las tres operaciones
 * del catálogo:
 *
 * - **Publicar** (CA 2): formulario en un `Modal` accesible con nombre,
 *   descripción, tipo, décimas (0.1–0.5, H10.1), costo en EduCoins, stock
 *   y aprobación automática. La validación vive en la fachada
 *   `features/teacher/api/items.ts` (mismas reglas que el backend, AGENTS
 *   §6); los errores del backend (422/403/409) llegan en español y se
 *   muestran tal cual.
 * - **Editar** (CA 3): el mismo formulario precargado; el tipo y la clase
 *   no cambian (supuesto de H4.1), así que el campo queda deshabilitado.
 * - **Archivar** (CA 3): `DELETE /items/:id` (borrado lógico) con
 *   confirmación obligatoria en `Modal`; el ítem desaparece de la tienda
 *   y el histórico de canjes no se toca.
 *
 * Estados cubiertos con el kit H5.2 (`@/components/ui`): **carga**,
 * **vacío** (sin clases / clase sin artículos) y **error** con reintento;
 * layout responsive (tabla con scroll horizontal en móvil) y controles
 * con `label` asociado (CA 5).
 */

"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  EstadoCarga,
  EstadoError,
  EstadoVacio,
  MENSAJE_ERROR_GENERICO,
  Modal,
  mensajeDeErrorApi,
  useToast,
} from "@/components/ui";
import { listarMisClases } from "@/features/teacher/api/clases";
import {
  actualizarItem,
  archivarItem,
  crearItem,
  DECIMAS_MAXIMAS,
  DECIMAS_MINIMAS,
  OPCIONES_DECIMAS,
  listarItemsClase,
  type DatosNuevoItem,
  type ItemTienda,
  type ParcheItem,
  type TipoItem,
  erroresPorTipo,
  erroresComunes,
} from "@/features/teacher/api/items";
import type { ClaseListado } from "@/features/teacher/tipos";
import { ApiError } from "@/lib/api-client";

/** Etiqueta en español y color de cada tipo de ítem. */
const ETIQUETAS_TIPO: Readonly<Record<TipoItem, string>> = {
  grade_bonus: "Bono de nota",
  fun_activity: "Actividad lúdica",
};

/** Badge de estado del artículo (Activo/Inactiva; el deleted no vuelve). */
function BadgeEstadoItem({ estado }: { estado: ItemTienda["status"] }) {
  const presentacion =
    estado === "active"
      ? { etiqueta: "Activo", clases: "bg-emerald-100 text-emerald-700" }
      : { etiqueta: "Inactiva", clases: "bg-slate-200 text-slate-700" };

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${presentacion.clases}`}
    >
      {presentacion.etiqueta}
    </span>
  );
}

/** Formato del costo en la tienda. */
function textoCosto(item: ItemTienda): string {
  return `${item.costCoins} EduCoins`;
}

/** Formato de las décimas del bono de nota (H10.1). */
function textoDecimas(item: ItemTienda): string {
  return item.gradePoints === null ? "—" : `${item.gradePoints.toFixed(1)} décimas`;
}

/** Formato del stock (null = ilimitado). */
function textoStock(item: ItemTienda): string {
  return item.stock === null ? "—" : String(item.stock);
}

/** Estado del formulario del modal: alta o edición. */
interface FormularioItem {
  /** Modo actual del modal. */
  modo: "crear" | "editar";
  /** Ítem en edición (solo en modo editar). */
  item: ItemTienda | null;
  /** Clase donde se crea (solo en modo crear). */
  claseId: string;
}

/** Campos controlados del formulario (idénticos para crear y editar). */
interface CamposItem {
  nombre: string;
  descripcion: string;
  tipo: TipoItem;
  decimas: string;
  costo: string;
  stock: string;
  autoAprobacion: boolean;
}

/** Campos por defecto de un alta. */
const CAMPOS_VACIOS: CamposItem = {
  nombre: "",
  descripcion: "",
  tipo: "fun_activity",
  decimas: "0.5",
  costo: "",
  stock: "0",
  autoAprobacion: false,
};

/** Campos por defecto tomados de un ítem existente (edición). */
function camposDeItem(item: ItemTienda): CamposItem {
  return {
    nombre: item.name,
    descripcion: item.description ?? "",
    tipo: item.type,
    decimas: item.gradePoints === null ? "0.5" : String(item.gradePoints),
    costo: String(item.costCoins),
    stock: item.stock === null ? "0" : String(item.stock),
    autoAprobacion: item.autoApprove,
  };
}

/**
 * Convierte los campos del formulario en los datos validables del alta.
 *
 * @param campos Campos controlados.
 * @returns Datos normalizados (vacío → null, numéricos parseados).
 */
function aDatosNuevoItem(campos: CamposItem): DatosNuevoItem {
  const tipo = campos.tipo;
  const decimas = Number.parseFloat(campos.decimas);

  return {
    name: campos.nombre,
    description: campos.descripcion.trim() === "" ? null : campos.descripcion.trim(),
    type: tipo,
    costCoins: Number.parseInt(campos.costo, 10),
    gradePoints: tipo === "grade_bonus" ? (Number.isNaN(decimas) ? null : decimas) : null,
    stock: tipo === "fun_activity" ? Number.parseInt(campos.stock, 10) : null,
    autoApprove: campos.autoAprobacion,
  };
}

/**
 * Convierte los campos del formulario en un parche de edición (PATCH).
 *
 * El `type` y la clase NO son editables (H4.1): el parche solo lleva los
 * campos del formulario, y la composición por tipo la revalida el backend
 * sobre el merge.
 *
 * @param campos Campos controlados del formulario.
 * @returns Parche coherente con el tipo del ítem.
 */
function aParcheItem(campos: CamposItem): ParcheItem {
  const decimas = Number.parseFloat(campos.decimas);

  return {
    name: campos.nombre,
    description: campos.descripcion.trim() === "" ? null : campos.descripcion.trim(),
    costCoins: Number.parseInt(campos.costo, 10),
    ...(campos.tipo === "grade_bonus"
      ? {
          gradePoints: Number.isNaN(decimas) ? null : decimas,
          stock: null,
        }
      : {
          stock: Number.parseInt(campos.stock, 10),
        }),
    autoApprove: campos.autoAprobacion,
  };
}

/**
 * Tienda de artículos por clase del panel docente (pestaña "Tienda").
 *
 * @returns Selector de clases + listado de artículos + formularios.
 */
export function TiendaClase() {
  const { mostrar } = useToast();

  // Selector de clases del profesor (las que tiene; las crea en "Mis Clases").
  const [clases, setClases] = useState<ClaseListado[]>([]);
  const [cargandoClases, setCargandoClases] = useState(true);
  const [errorClases, setErrorClases] = useState<string | null>(null);
  const [recargaClases, setRecargaClases] = useState(0);
  const [claseId, setClaseId] = useState<string | null>(null);

  // Catálogo de la clase elegida.
  const [items, setItems] = useState<ItemTienda[]>([]);
  const [cargandoItems, setCargandoItems] = useState(false);
  const [errorItems, setErrorItems] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  // Formulario de alta/edición (modal).
  const [formulario, setFormulario] = useState<FormularioItem | null>(null);
  const [campos, setCampos] = useState<CamposItem>(CAMPOS_VACIOS);
  const [erroresFormulario, setErroresFormulario] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);

  // Archivado (borrado lógico) con confirmación.
  const [itemAArchivar, setItemAArchivar] = useState<ItemTienda | null>(null);
  const [archivando, setArchivando] = useState(false);

  // 1) Clases del profesor (se recarga al reintentar).
  useEffect(() => {
    let vigente = true;

    async function cargarClases(): Promise<void> {
      try {
        const resultado = await listarMisClases(1, 50);

        if (vigente) {
          setClases(resultado.data);
          // Primera clase activa por defecto (el backend ordena desc).
          setClaseId(resultado.data[0]?.id ?? null);
          setErrorClases(null);
        }
      } catch (e) {
        if (vigente) {
          setErrorClases(
            e instanceof ApiError ? e.message : MENSAJE_ERROR_GENERICO,
          );
        }
      } finally {
        if (vigente) {
          setCargandoClases(false);
        }
      }
    }

    void cargarClases();

    return () => {
      vigente = false;
    };
  }, [recargaClases]);

  /** Reintenta la carga de clases (estado de error, CA 5). */
  const reintentarClases = (): void => {
    setCargandoClases(true);
    setRecargaClases((anterior) => anterior + 1);
  };

  // 2) Artículos de la clase elegida.
  useEffect(() => {
    if (claseId === null) {
      return;
    }

    let vigente = true;

    async function cargarItems(): Promise<void> {
      setCargandoItems(true);

      try {
        const filas = await listarItemsClase(claseId as string);

        if (vigente) {
          setItems(filas);
          setErrorItems(null);
        }
      } catch (e) {
        if (vigente) {
          setItems([]);
          setErrorItems(
            e instanceof ApiError ? e.message : MENSAJE_ERROR_GENERICO,
          );
        }
      } finally {
        if (vigente) {
          setCargandoItems(false);
        }
      }
    }

    void cargarItems();

    return () => {
      vigente = false;
    };
  }, [claseId, recarga]);

  /** Recarga el catálogo de la clase (tras crear/editar/archivar o reintentar). */
  const recargar = (): void => {
    setCargandoItems(true);
    setRecarga((anterior) => anterior + 1);
  };

  /**
   * Abre el modal de alta con los campos vacíos.
   */
  const abrirAlta = (): void => {
    if (claseId === null) return;
    setCampos(CAMPOS_VACIOS);
    setErroresFormulario([]);
    setFormulario({ modo: "crear", item: null, claseId });
  };

  /**
   * Abre el modal de edición precargado con el ítem elegido.
   *
   * @param item Ítem a editar.
   */
  const abrirEdicion = (item: ItemTienda): void => {
    setCampos(camposDeItem(item));
    setErroresFormulario([]);
    setFormulario({ modo: "editar", item, claseId: item.claseId });
  };

  /**
   * Valida y envía el formulario (alta o edición).
   *
   * La validación cliente replica las reglas del backend (fachada
   * `api/items.ts`): si falla, muestra los mensajes en español sin llamar
   * a la API; si pasa, muestra el toast de éxito y recarga la tienda.
   */
  async function enviarFormulario(): Promise<void> {
    if (formulario === null) return;

    const datos = aDatosNuevoItem(campos);
    const errores = [...erroresComunes(datos), ...erroresPorTipo(datos.type, datos.gradePoints, datos.stock)];

    if (errores.length > 0) {
      setErroresFormulario(errores);
      return;
    }

    setEnviando(true);
    setErroresFormulario([]);

    try {
      if (formulario.modo === "crear") {
        await crearItem(formulario.claseId, datos);
        mostrar("Artículo publicado.", "exito");
      } else if (formulario.item !== null) {
        await actualizarItem(formulario.item.id, aParcheItem(campos));
        mostrar("Artículo actualizado.", "exito");
      }

      setFormulario(null);
      recargar();
    } catch (e) {
      setErroresFormulario([mensajeDeErrorApi(e)]);
    } finally {
      setEnviando(false);
    }
  }

  /**
   * Confirma el archivado (borrado lógico del backend) y recarga.
   */
  async function confirmarArchivado(): Promise<void> {
    if (itemAArchivar === null) return;

    setArchivando(true);

    try {
      await archivarItem(itemAArchivar.id);
      mostrar("Artículo archivado.", "exito");
      setItemAArchivar(null);
      recargar();
    } catch (e) {
      mostrar(mensajeDeErrorApi(e), "error");
      setItemAArchivar(null);
    } finally {
      setArchivando(false);
    }
  }

  const claseElegida = clases.find((clase) => clase.id === claseId) ?? null;

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-slate-500">
        Publica los artículos que tus estudiantes pueden canjear por sus
        EduCoins, clase por clase: bonos de nota (0.1 a 0.5 décimas) y
        actividades lúdicas con stock.
      </p>

      {cargandoClases && <EstadoCarga mensaje="Cargando tus clases…" />}

      {errorClases !== null && !cargandoClases && (
        <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <EstadoError mensaje={errorClases} alReintentar={reintentarClases} />
        </div>
      )}

      {errorClases === null && !cargandoClases && clases.length === 0 && (
        <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <EstadoVacio
            titulo="Aún no tienes clases"
            descripcion="Crea una clase para poder publicar artículos que tus estudiantes canjeen."
          />
        </div>
      )}

      {errorClases === null && !cargandoClases && clases.length > 0 && (
        <>
          {/* Selector de clases (CA 1): solo las clases del profesor. */}
          <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="w-full sm:max-w-xs">
                <label
                  htmlFor="clase-tienda"
                  className="block text-sm font-medium text-slate-700"
                >
                  Clase
                </label>
                <select
                  id="clase-tienda"
                  value={claseId ?? ""}
                  onChange={(evento) => {
                    // Solo cambia si la clase es distinta: si el profesor
                    // re-selecciona la clase ya activa (la primera por
                    // defecto), no hay que recargar nada — y forzar
                    // `cargandoItems` aquí dejaría la tienda "Cargando…"
                    // para siempre, porque con el mismo `claseId` el
                    // efecto de carga no se vuelve a ejecutar (H10.2).
                    if (evento.target.value !== claseId) {
                      setClaseId(evento.target.value);
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  {clases.map((clase) => (
                    <option key={clase.id} value={clase.id}>
                      {clase.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={abrirAlta}
                disabled={claseId === null}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-40"
              >
                Publicar artículo
              </button>
            </div>
          </div>

          {/* Catálogo de la clase elegida. */}
          <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            {cargandoItems && <EstadoCarga mensaje="Cargando artículos…" />}

            {errorItems !== null && !cargandoItems && (
              <EstadoError mensaje={errorItems} alReintentar={recargar} />
            )}

            {errorItems === null && !cargandoItems && items.length === 0 && (
              <EstadoVacio
                titulo="Esta clase todavía no tiene artículos"
                descripcion={`Publica bonos de nota o actividades lúdicas para que tus estudiantes de “${claseElegida?.nombre ?? ""}” puedan canjear sus EduCoins.`}
                accion={{ texto: "Publicar artículo", alHacerClic: abrirAlta }}
              />
            )}

            {errorItems === null && !cargandoItems && items.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[44rem] text-sm">
                  <caption className="sr-only">
                    Artículos de la clase elegida
                  </caption>
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th scope="col" className="px-4 py-3 font-medium">
                        Artículo
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Tipo
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Costo
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Décimas
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Stock
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Auto-aprobación
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Estado
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{item.name}</p>
                          {item.description !== null && (
                            <p className="mt-0.5 text-xs text-slate-500">
                              {item.description}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {ETIQUETAS_TIPO[item.type]}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {textoCosto(item)}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {textoDecimas(item)}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {textoStock(item)}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {item.autoApprove ? "Sí" : "No"}
                        </td>
                        <td className="px-4 py-3">
                          <BadgeEstadoItem estado={item.status} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => abrirEdicion(item)}
                              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => setItemAArchivar(item)}
                              className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                            >
                              Archivar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Formulario de alta/edición (CA 2 y 3). */}
      <Modal
        abierto={formulario !== null}
        titulo={formulario?.modo === "editar" ? "Editar artículo" : "Publicar artículo"}
        alCerrar={() => {
          if (!enviando) setFormulario(null);
        }}
        acciones={
          <>
            <button
              type="button"
              onClick={() => void enviarFormulario()}
              disabled={enviando}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              {enviando
                ? "Guardando…"
                : formulario?.modo === "editar"
                  ? "Guardar cambios"
                  : "Publicar"}
            </button>
            <button
              type="button"
              onClick={() => setFormulario(null)}
              disabled={enviando}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              Cancelar
            </button>
          </>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(evento: FormEvent<HTMLFormElement>) => {
            evento.preventDefault();
            void enviarFormulario();
          }}
        >
          <div>
            <label
              htmlFor="item-nombre"
              className="block text-sm font-medium text-slate-700"
            >
              Nombre
            </label>
            <input
              id="item-nombre"
              type="text"
              value={campos.nombre}
              onChange={(evento) =>
                setCampos((actuales) => ({ ...actuales, nombre: evento.target.value }))
              }
              maxLength={150}
              required
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
          </div>

          <div>
            <label
              htmlFor="item-descripcion"
              className="block text-sm font-medium text-slate-700"
            >
              Descripción <span className="text-slate-400">(opcional)</span>
            </label>
            <textarea
              id="item-descripcion"
              value={campos.descripcion}
              onChange={(evento) =>
                setCampos((actuales) => ({
                  ...actuales,
                  descripcion: evento.target.value,
                }))
              }
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
          </div>

          <div>
            <label
              htmlFor="item-tipo"
              className="block text-sm font-medium text-slate-700"
            >
              Tipo
            </label>
            <select
              id="item-tipo"
              value={campos.tipo}
              disabled={formulario?.modo === "editar"}
              onChange={(evento) =>
                setCampos((actuales) => ({
                  ...actuales,
                  tipo: evento.target.value as TipoItem,
                }))
              }
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-500"
            >
              <option value="grade_bonus">Bono de nota (décimas)</option>
              <option value="fun_activity">Actividad lúdica (stock)</option>
            </select>
          </div>

          {campos.tipo === "grade_bonus" && (
            <div>
              <label
                htmlFor="item-decimas"
                className="block text-sm font-medium text-slate-700"
              >
                Décimas de nota ({DECIMAS_MINIMAS.toFixed(1)}–
                {DECIMAS_MAXIMAS.toFixed(1)})
              </label>
              <select
                id="item-decimas"
                value={campos.decimas}
                onChange={(evento) =>
                  setCampos((actuales) => ({
                    ...actuales,
                    decimas: evento.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {OPCIONES_DECIMAS.map((opcion) => (
                  <option key={opcion} value={String(opcion)}>
                    {opcion.toFixed(1)} décimas
                  </option>
                ))}
              </select>
            </div>
          )}

          {campos.tipo === "fun_activity" && (
            <div>
              <label
                htmlFor="item-stock"
                className="block text-sm font-medium text-slate-700"
              >
                Stock (existencias)
              </label>
              <input
                id="item-stock"
                type="number"
                min={0}
                step={1}
                value={campos.stock}
                onChange={(evento) =>
                  setCampos((actuales) => ({ ...actuales, stock: evento.target.value }))
                }
                required
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              />
            </div>
          )}

          <div>
            <label
              htmlFor="item-costo"
              className="block text-sm font-medium text-slate-700"
            >
              Costo en EduCoins
            </label>
            <input
              id="item-costo"
              type="number"
              min={1}
              step={1}
              value={campos.costo}
              onChange={(evento) =>
                setCampos((actuales) => ({ ...actuales, costo: evento.target.value }))
              }
              required
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
          </div>

          <div className="flex items-start gap-2">
            <input
              id="item-auto-aprobacion"
              type="checkbox"
              checked={campos.autoAprobacion}
              onChange={(evento) =>
                setCampos((actuales) => ({
                  ...actuales,
                  autoAprobacion: evento.target.checked,
                }))
              }
              className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
            <label htmlFor="item-auto-aprobacion" className="text-sm text-slate-700">
              Aprobación automática: los canjes de este artículo se aprueban
              solos, sin pasar por tu cola de solicitudes.
            </label>
          </div>

          {erroresFormulario.length > 0 && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              <ul className="list-inside list-disc space-y-1">
                {erroresFormulario.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}
        </form>
      </Modal>

      {/* Confirmación antes de archivar (CA 3). */}
      <Modal
        abierto={itemAArchivar !== null}
        titulo="Archivar artículo"
        alCerrar={() => {
          if (!archivando) setItemAArchivar(null);
        }}
        acciones={
          <>
            <button
              type="button"
              onClick={() => void confirmarArchivado()}
              disabled={archivando}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
            >
              {archivando ? "Archivando…" : "Archivar"}
            </button>
            <button
              type="button"
              onClick={() => setItemAArchivar(null)}
              disabled={archivando}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              Cancelar
            </button>
          </>
        }
      >
        {itemAArchivar !== null && (
          <p className="text-sm text-slate-700">
            ¿Archivar “{itemAArchivar.name}”? Los estudiantes ya no podrán
            canjearlo y desaparecerá de la tienda. El histórico de canjes no
            se toca.
          </p>
        )}
      </Modal>
    </div>
  );
}
