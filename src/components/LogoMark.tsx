import * as React from 'react'

interface LogoMarkProps extends React.SVGProps<SVGSVGElement> {
  size?: number
  mono?: boolean
}

export function LogoMark({ size = 26, mono = false, className, ...rest }: LogoMarkProps) {
  const gid = React.useId()
  const fill = mono ? 'currentColor' : `url(#${gid})`

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      className={className}
      {...rest}
    >
      {!mono && (
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#27f4ff" />
            <stop offset="1" stopColor="#10d4ea" />
          </linearGradient>
        </defs>
      )}
      <g fill={fill}>
        <path d="M4 4.5 L10.6 12 L4 19.5 Z" />
        <rect x="12.1" y="5" width="7.9" height="2.2" rx="1.1" />
        <rect x="12.1" y="10.9" width="9.9" height="2.2" rx="1.1" />
        <rect x="12.1" y="16.8" width="6.5" height="2.2" rx="1.1" />
        <circle cx="21" cy="6.1" r="1.05" />
        <circle cx="21" cy="17.9" r="1.05" />
      </g>
    </svg>
  )
}

export default LogoMark
