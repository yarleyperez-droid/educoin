import type { ReactNode } from 'react';

type IconProps = {
  className?: string;
};

function Icon({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 20 20'
      fill='currentColor'
      className={className ?? 'h-5 w-5'}
      aria-hidden='true'
    >
      {children}
    </svg>
  );
}

export function IconDashboard({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M3 4a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4Zm0 7a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5Zm9-7a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V4Zm0 6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-6Z' />
    </Icon>
  );
}

export function IconActivities({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M7 3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3V3Zm2 0v1h2V3H9Z' />
      <path d='M5 9h10v2H5V9Zm0 4h7v2H5v-2Z' />
    </Icon>
  );
}

export function IconWallet({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M2 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2h-3a3 3 0 0 0 0 6h3v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6Zm15 3a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z' />
    </Icon>
  );
}

export function IconRanking({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M15 2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h2ZM9 6a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h2ZM3 10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h2Z' />
    </Icon>
  );
}

export function IconProgress({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M13.5 3a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1 0-1.5h1.69L9.22 6.47a.75.75 0 0 1-1.06 0L6.5 4.81 3.28 8.03a.75.75 0 0 1-1.06-1.06l4-4a.75.75 0 0 1 1.06 0L9.22 4.66l2.97-2.97H10a.75.75 0 0 1 0-1.5h3.5Z' />
    </Icon>
  );
}

export function IconSearch({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM2 8a6 6 0 1 1 11.89 1.477l3.817 3.817a1 1 0 0 1-1.414 1.414l-3.816-3.816A6 6 0 0 1 2 8Z' />
    </Icon>
  );
}

export function IconBell({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M10 2a6 6 0 0 1 6 6v2.586l.707.707a1 1 0 0 1 0 1.414l-2 2a1 1 0 0 1-.707.293H6a1 1 0 0 1-.707-.293l-2-2a1 1 0 0 1 0-1.414l.707-.707V8a6 6 0 0 1 6-6Zm0 13a2 2 0 0 0 2-2H8a2 2 0 0 0 2 2Z' />
    </Icon>
  );
}

export function IconCoin({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm1-11.5a1 1 0 1 0-2 0v.75H8a.75.75 0 0 0 0 1.5h1.5v1H8a.75.75 0 0 0 0 1.5h1.5v.75a1 1 0 1 0 2 0v-.75H13a.75.75 0 0 0 0-1.5h-1.5v-1H13a.75.75 0 0 0 0-1.5h-1.5v-.75Z' />
    </Icon>
  );
}

export function IconUser({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 9a6 6 0 0 1 12 0 1 1 0 0 1-2 0 4 4 0 0 0-8 0 1 1 0 0 1-2 0Z' />
    </Icon>
  );
}

export function IconMenu({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M2 5h16a1 1 0 0 1 0 2H2a1 1 0 1 1 0-2Zm0 4h16a1 1 0 0 1 0 2H2a1 1 0 1 1 0-2Zm0 4h16a1 1 0 0 1 0 2H2a1 1 0 0 1 0-2Z' />
    </Icon>
  );
}

export function IconX({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M5.293 5.293a1 1 0 0 1 1.414 0L10 8.586l3.293-3.293a1 1 0 1 1 1.414 1.414L11.414 10l3.293 3.293a1 1 0 0 1-1.414 1.414L10 11.414l-3.293 3.293a1 1 0 0 1-1.414-1.414L8.586 10 5.293 6.707a1 1 0 0 1 0-1.414Z' />
    </Icon>
  );
}

export function IconCheckCircle({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path
        fillRule='evenodd'
        d='M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.883l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z'
        clipRule='evenodd'
      />
    </Icon>
  );
}

export function IconArrowRight({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M10.293 3.293a1 1 0 0 1 1.414 0l6 6a1 1 0 0 1 0 1.414l-6 6a1 1 0 0 1-1.414-1.414L14.586 11H3a1 1 0 1 1 0-2h11.586l-4.293-4.293a1 1 0 0 1 0-1.414Z' />
    </Icon>
  );
}

export function IconDownload({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M10 2a1 1 0 0 1 1 1v7.586l2.293-2.293a1 1 0 1 1 1.414 1.414l-4 4a1 1 0 0 1-1.414 0l-4-4a1 1 0 0 1 1.414-1.414L9 10.586V3a1 1 0 0 1 1-1Zm-4 12a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2H6Z' />
    </Icon>
  );
}

export function IconClock({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm1-8.414V6a1 1 0 1 0-2 0v4a1 1 0 0 0 .293.707l2.828 2.829a1 1 0 1 0 1.415-1.414L11 9.586Z' />
    </Icon>
  );
}

export function IconCalendar({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M5 4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1v2H2V6a1 1 0 0 1 1-1h2V4Zm-2 5h16v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z' />
    </Icon>
  );
}

export function IconZap({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M10.5 2a1 1 0 0 1 .949.684l1.5 4.5a1 1 0 0 1-.949 1.316h-1.5l2 6a1 1 0 0 1-1.732 1l-6-9A1 1 0 0 1 5.5 6h2.05l-1.3-3.25a1 1 0 0 1 .929-1.75h3.321Z' />
    </Icon>
  );
}

export function IconTrophy({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M10 2a1 1 0 0 1 1 1v1.05A9 9 0 0 1 20 12v1h-2.05A7 7 0 0 1 12 18.95V20a1 1 0 0 1-2 0v-1.05A7 7 0 0 1 4.05 13H2v-1a9 9 0 0 1 7-8.95V3a1 1 0 0 1 1-1Zm0 13a5 5 0 0 0 5-5H5a5 5 0 0 0 5 5Z' />
    </Icon>
  );
}

export function IconBuilding({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M10 2a1 1 0 0 1 .832.445l4 6A1 1 0 0 1 15 10h-1v5a1 1 0 0 1-1 1h-1v-4H8v4H7a1 1 0 0 1-1-1v-5H5a1 1 0 0 1-.832-1.555l4-6A1 1 0 0 1 10 2Z' />
    </Icon>
  );
}

export function IconShield({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M10 2a1 1 0 0 1 .832.445l4 2.667A1 1 0 0 1 16 5.333V10a6 6 0 0 1-5.293 5.95l-.707.078-.707-.078A6 6 0 0 1 4 10V5.333a1 1 0 0 1 .168-.555l4-2.667A1 1 0 0 1 10 2Z' />
    </Icon>
  );
}

export function IconHelp({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-13a1 1 0 0 1 1 1v.5a1 1 0 0 1-2 0V6a1 1 0 0 1 1-1Zm1 5a1 1 0 1 0-2 0v3a1 1 0 1 0 2 0V10Z' />
    </Icon>
  );
}

export function IconLock({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M5 9V7a5 5 0 0 1 10 0v2h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h1Zm2-2a3 3 0 0 1 6 0v2H7V7Z' />
    </Icon>
  );
}

export function IconBookOpen({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M3 4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4Zm8 0a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V4Z' />
    </Icon>
  );
}

export function IconDocumentText({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M4 3a1 1 0 0 1 1-1h5.586a1 1 0 0 1 .707.293l4.414 4.414a1 1 0 0 1 .293.707V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3Zm2 2v11h8V8h-3a1 1 0 0 1-1-1V4H6Zm4 0v2h2.586L10 4Z' />
    </Icon>
  );
}

export function IconPlus({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M10 3a1 1 0 0 1 1 1v5h5a1 1 0 1 1 0 2h-5v5a1 1 0 1 1-2 0v-5H4a1 1 0 1 1 0-2h5V4a1 1 0 0 1 1-1Z' />
    </Icon>
  );
}

export function IconUsers({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M8 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 9a5 5 0 0 1 10 0 1 1 0 0 1-2 0 3 3 0 0 0-6 0 1 1 0 0 1-2 0Zm11-8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm.5 2a4.5 4.5 0 0 1 4.5 4.5 1 1 0 0 1-2 0 2.5 2.5 0 0 0-5 0 1 1 0 0 1-2 0A4.5 4.5 0 0 1 14.5 13Z' />
    </Icon>
  );
}

export function IconClasses({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d='M3 4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3H3V4Zm0 5h14v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9Zm3 2v2h4v-2H6Z' />
    </Icon>
  );
}
