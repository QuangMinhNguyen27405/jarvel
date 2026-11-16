// Small inline SVG icons and illustrations, drawn from the approved "C · Travel" mock-ups. Every one is decorative
// (aria-hidden) unless it says otherwise: the text next to it carries the meaning.
import type { ReactNode } from 'react';

interface IconProps {
  className?: string;
  size?: number;
}

const PLANE = 'M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z';

/** A plane. `heading` turns it: 0 points up, 45 up and right, 90 right. */
export function PlaneIcon({ className, size = 16, heading = 0 }: IconProps & { heading?: number }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d={PLANE} transform={heading ? `rotate(${heading} 12 12)` : undefined} />
    </svg>
  );
}

function Stroke({ className, size = 16, width = 2, children }: IconProps & { width?: number; children: ReactNode }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const ArrowLeftIcon = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </Stroke>
);

export const PersonIcon = (props: IconProps) => (
  <Stroke {...props} width={2.2}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />
  </Stroke>
);

export const WalkIcon = (props: IconProps) => (
  <Stroke {...props}>
    <circle cx="13" cy="4" r="2" />
    <path d="M10 21l2-6-3-3 1-5 4 3 3 1M9 12l-2 3" />
  </Stroke>
);

export const ChevronIcon = (props: IconProps) => (
  <Stroke {...props} width={2.4}>
    <path d="M9 6l6 6-6 6" />
  </Stroke>
);

export const PlusIcon = (props: IconProps) => (
  <Stroke {...props} width={2.4}>
    <path d="M12 5v14M5 12h14" />
  </Stroke>
);

export const CheckIcon = (props: IconProps) => (
  <Stroke {...props} width={3}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Stroke>
);

export const CrossIcon = (props: IconProps) => (
  <Stroke {...props} width={3.2}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Stroke>
);

export const AlertIcon = (props: IconProps) => (
  <Stroke {...props} width={2.2}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5v.01" />
  </Stroke>
);

export const ShieldIcon = (props: IconProps) => (
  <Stroke {...props} width={2.2}>
    <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" />
  </Stroke>
);

export function HeartIcon({ className, size = 14 }: IconProps) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z" />
    </svg>
  );
}

export function DotsIcon({ className, size = 20 }: IconProps) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

/** The dashed flight path with a plane between two dates. It reads as "to". */
export function RouteArrow({ className, width = 44 }: { className?: string; width?: number }) {
  const tip = width - 7;
  return (
    <svg
      className={className}
      role="img"
      aria-label="to"
      width={width}
      height="14"
      viewBox={`0 0 ${width} 14`}
      fill="none"
    >
      <path
        className="route-arrow-dash"
        d={`M1 7h${width - 20}`}
        strokeWidth="1.5"
        strokeDasharray="3 5"
        strokeLinecap="round"
      />
      <g transform={`translate(${tip} 7) rotate(90) translate(-7 -7)`}>
        <path
          d="M12.25 9.33V8.17L7.58 5.25V2.04a.875.875 0 0 0-1.75 0V5.25L1.17 8.17v1.16l4.66-1.46v3.21l-1.16.88v.87l2.04-.58 2.04.58v-.87l-1.17-.88V7.87z"
          className="route-arrow-plane"
        />
      </g>
    </svg>
  );
}

/** The loading mark: a plane on a dashed arc. */
export function FlightPath({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      focusable="false"
      width="120"
      height="24"
      viewBox="0 0 120 24"
      fill="none"
    >
      <path
        className="flight-path-arc"
        d="M4 18 Q60 -2 116 18"
        strokeWidth="1.5"
        strokeDasharray="3 5"
        strokeLinecap="round"
      />
      <g className="flight-path-plane" transform="translate(66 3) rotate(95)">
        <path
          d="M10.5 8V7L6.5 4.5V1.75a.75.75 0 0 0-1.5 0V4.5L1 7v1l4-1.25V9.5L4 10.25V11l1.75-.5L7.5 11v-.75L6.5 9.5V6.75z"
          className="flight-path-body"
          transform="translate(-6 -6)"
        />
      </g>
    </svg>
  );
}

/** The empty-list illustration: an open passport with one stamp, "YOUR TRIP". */
export function PassportArt({ className }: { className?: string }) {
  return (
    <svg className={className} aria-hidden="true" focusable="false" viewBox="0 0 240 170">
      <rect x="10" y="10" width="220" height="150" rx="10" fill="#1F4E5A" />
      <rect x="18" y="16" width="100" height="138" rx="4" fill="#FBF6EC" />
      <rect x="122" y="16" width="100" height="138" rx="4" fill="#FBF6EC" />
      <path d="M120 16v138" stroke="#DCCFB8" strokeWidth="2" />
      <circle cx="52" cy="58" r="22" fill="none" stroke="#CDBFA5" strokeWidth="2" strokeDasharray="4 4" />
      <rect
        x="68"
        y="92"
        width="38"
        height="30"
        rx="4"
        fill="none"
        stroke="#CDBFA5"
        strokeWidth="2"
        strokeDasharray="4 4"
        transform="rotate(-6 87 107)"
      />
      <g transform="rotate(-10 160 64)">
        <circle cx="160" cy="64" r="24" fill="none" stroke="#155E67" strokeWidth="2.5" />
        <text
          x="160"
          y="62"
          textAnchor="middle"
          fontFamily="'IBM Plex Mono', ui-monospace, monospace"
          fontSize="8"
          fontWeight="600"
          fill="#155E67"
        >
          YOUR
        </text>
        <text
          x="160"
          y="72"
          textAnchor="middle"
          fontFamily="'IBM Plex Mono', ui-monospace, monospace"
          fontSize="8"
          fontWeight="600"
          fill="#155E67"
        >
          TRIP
        </text>
      </g>
      <rect
        x="146"
        y="104"
        width="56"
        height="30"
        rx="4"
        fill="none"
        stroke="#CDBFA5"
        strokeWidth="2"
        strokeDasharray="4 4"
        transform="rotate(5 174 119)"
      />
    </svg>
  );
}

/** The sign-in postcard picture: Boston's skyline at sunset over the harbor, with a sailboat. */
export function SkylineArt({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 400 300"
      preserveAspectRatio="xMidYMax slice"
    >
      <defs>
        <linearGradient id="jarvel-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F9E9CC" />
          <stop offset="1" stopColor="#F3C08C" />
        </linearGradient>
      </defs>
      <rect width="400" height="300" fill="url(#jarvel-sky)" />
      <circle cx="300" cy="168" r="42" fill="#F2B544" />
      <g fill="#7FA9A7">
        <rect x="18" y="150" width="30" height="70" />
        <rect x="150" y="108" width="22" height="112" />
        <rect x="218" y="124" width="22" height="96" />
        <rect x="288" y="134" width="24" height="86" />
        <rect x="356" y="152" width="34" height="68" />
      </g>
      <g fill="#155E67">
        <rect x="0" y="172" width="40" height="48" />
        <rect x="40" y="152" width="30" height="68" />
        <rect x="70" y="186" width="35" height="34" />
        <rect x="105" y="120" width="24" height="100" />
        <path d="M105 120l12-22 12 22z" />
        <rect x="115" y="90" width="4" height="10" />
        <rect x="129" y="162" width="40" height="58" />
        <rect x="169" y="142" width="28" height="78" />
        <rect x="197" y="176" width="45" height="44" />
        <path d="M242 220V128l30 8v84z" />
        <rect x="272" y="166" width="40" height="54" />
        <rect x="312" y="150" width="26" height="70" />
        <rect x="338" y="182" width="62" height="38" />
      </g>
      <rect y="218" width="400" height="82" fill="#2F5D8C" />
      <path d="M268 232h64M280 244h40M292 256h16" stroke="#F2B544" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M20 248q10-6 20 0t20 0M150 266q10-6 20 0t20 0M210 240q10-6 20 0t20 0M40 284q10-6 20 0t20 0M330 280q10-6 20 0t20 0"
        stroke="#8FB3D3"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M96 252h44l-6 10h-32z" fill="#1F2933" />
      <path d="M118 250V212l18 38z" fill="#FFFCF6" />
      <path d="M116 250v-30l-14 30z" fill="#F4EEE2" />
    </svg>
  );
}

/** The postage stamp on the sign-in card ("JARVEL") with a Boston postmark over its corner. */
export function PostageStamp({ className }: { className?: string }) {
  return (
    <div className={['postage', className].filter(Boolean).join(' ')} aria-hidden="true">
      <div className="postage-perf">
        <div className="postage-face">
          <PlaneIcon size={22} heading={45} />
          <span>JARVEL</span>
        </div>
      </div>
      <svg className="postage-mark" width="80" height="80" viewBox="0 0 80 80" focusable="false">
        <circle cx="40" cy="40" r="26" fill="none" stroke="#B23A24" strokeWidth="2" />
        <circle cx="40" cy="40" r="20" fill="none" stroke="#B23A24" strokeWidth="1" />
        <text
          x="40"
          y="38"
          textAnchor="middle"
          fontFamily="'IBM Plex Mono', ui-monospace, monospace"
          fontSize="7"
          fontWeight="600"
          fill="#B23A24"
        >
          BOSTON
        </text>
        <text
          x="40"
          y="47"
          textAnchor="middle"
          fontFamily="'IBM Plex Mono', ui-monospace, monospace"
          fontSize="7"
          fontWeight="600"
          fill="#B23A24"
        >
          MA
        </text>
        <path d="M66 32q5-3 10 0M66 40q5-3 10 0M66 48q5-3 10 0" stroke="#B23A24" strokeWidth="1.5" fill="none" />
      </svg>
    </div>
  );
}

/** The brand: a teal disc with a plane, and "jarvel" in italic. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={['brand-mark', className].filter(Boolean).join(' ')}>
      <span className="brand-disc" aria-hidden="true">
        <PlaneIcon size={16} heading={45} />
      </span>
      <span className="brand-word">jarvel</span>
    </span>
  );
}
