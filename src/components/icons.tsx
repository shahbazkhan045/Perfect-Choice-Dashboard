/**
 * The dashboard's icon set — inline SVG, no dependency.
 *
 * Paths are the Lucide line set (ISC licensed), drawn at a 24-unit viewBox
 * with `currentColor` strokes so an icon always matches the text beside it.
 * Every icon is decorative: it sits next to a visible text label and is
 * hidden from screen readers, so nothing here is the only way to read a
 * control.
 */

type IconProps = {
  /** Rendered size in px; 16-18 everywhere in the app. */
  size?: number;
  className?: string;
};

function Svg({ size = 16, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Cash collection. */
export function BanknoteIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect width="20" height="12" x="2" y="6" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01M18 12h.01" />
    </Svg>
  );
}

/** Cancellations & releases. */
export function BanIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </Svg>
  );
}

/** Company performance. */
export function BuildingIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect width="16" height="20" x="4" y="2" rx="2" />
      <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" />
    </Svg>
  );
}

/** Switch to dark mode. */
export function MoonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </Svg>
  );
}

/** Switch to light mode. */
export function SunIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </Svg>
  );
}

/** Attach / replace a screenshot. */
export function PaperclipIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13.2 2.8a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
      <path d="M8.1 7.4 4.6 10.9a6 6 0 0 0 8.5 8.5l3.5-3.5" />
    </Svg>
  );
}

/** Refresh. */
export function RefreshIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 21v-5h5" />
    </Svg>
  );
}

/** Download. */
export function DownloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </Svg>
  );
}

/** Send the reminder email. */
export function MailIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m2 7 10 6 10-6" />
    </Svg>
  );
}

/** Success. */
export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  );
}

/** Dismiss / cancel. */
export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  );
}

/** Warning or error. */
export function AlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </Svg>
  );
}

/** The access gate. */
export function LockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Svg>
  );
}

/** Average rating. */
export function StarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9Z" />
    </Svg>
  );
}

/** Greeting on the "add your name" banner. */
export function UserIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Svg>
  );
}

/** Edit the name updates are signed with. */
export function PencilIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Svg>
  );
}

/** A rate or percentage. */
export function PercentIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 5 5 19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </Svg>
  );
}

/** Punctuality / on time. */
export function ClockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </Svg>
  );
}

/** An absence — someone who was expected and did not come. */
export function UserMinusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <path d="M17 11h5" />
    </Svg>
  );
}

/** A count of entries still waiting on someone. */
export function HourglassIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 3h12M6 21h12" />
      <path d="M8 3v4a4 4 0 0 0 8 0V3" />
      <path d="M8 21v-4a4 4 0 0 1 8 0v4" />
    </Svg>
  );
}

/** Money in hand. */
export function WalletIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2" />
      <rect width="18" height="13" x="3" y="7" rx="2" />
      <path d="M16 13h3" />
    </Svg>
  );
}

/** A ticket raised with support. */
export function TicketIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4Z" />
      <path d="M12 7v10" />
    </Svg>
  );
}

/** A written reason or note. */
export function NoteIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </Svg>
  );
}
