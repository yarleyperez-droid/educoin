/**
 * Kit UI compartido del frontend (H5.2 / PRO-283).
 *
 * Punto único de importación de los estados base y del toast accesible;
 * todos los paneles deben importar desde `@/components/ui` (AGENTS.md §8:
 * estados de UI obligatorios de carga, vacío y error).
 *
 * @packageDocumentation
 */

export { EstadoCarga, type PropsEstadoCarga } from "./estado-carga";
export {
  EstadoVacio,
  type AccionSugerida,
  type PropsEstadoVacio,
} from "./estado-vacio";
export { EstadoError, type PropsEstadoError } from "./estado-error";
export { Modal, type PropsModal } from "./modal";
export {
  MENSAJE_ERROR_GENERICO,
  ProveedorToast,
  mensajeDeErrorApi,
  useToast,
  type ContextoToast,
  type Toast,
  type VarianteToast,
} from "./toast";
export {
  IconDashboard,
  IconActivities,
  IconWallet,
  IconRanking,
  IconProgress,
  IconSearch,
  IconBell,
  IconCoin,
  IconUser,
  IconMenu,
  IconX,
  IconCheckCircle,
  IconArrowRight,
  IconDownload,
  IconClock,
  IconCalendar,
  IconZap,
  IconTrophy,
  IconBuilding,
  IconHelp,
  IconShield,
  IconLock,
  IconBookOpen,
  IconDocumentText,
  IconPlus,
  IconUsers,
  IconClasses,
} from "./iconos";
