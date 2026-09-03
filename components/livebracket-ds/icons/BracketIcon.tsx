import React from 'react';

export interface BracketIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  color?: string;
  glyphColor?: string;
  disc?: boolean;
}

export function BracketIcon({
  size = 16,
  color = 'currentColor',
  glyphColor,
  disc = false,
  style,
  ...props
}: BracketIconProps) {
  const fill = glyphColor || color;

  if (!disc) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="400 175 480 480"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ display: 'inline-block', flexShrink: 0, verticalAlign: 'middle', ...style }}
        {...props}
      >
        <rect x="428" y="234" width="165.327" height="35.9406" rx="15" fill={fill} />
        <rect x="428" y="561.059" width="165.327" height="35.9406" rx="15" fill={fill} />
        <rect x="593.327" y="308.277" width="165.327" height="35.9406" rx="15" fill={fill} />
        <rect x="722.713" y="462.822" width="129.386" height="35.9406" rx="15" fill={fill} />
        <rect x="593.327" y="489.178" width="129.386" height="35.9406" rx="15" fill={fill} />
        <rect x="557.386" y="416.099" width="182.099" height="35.9406" rx="15" transform="rotate(-90 557.386 416.099)" fill={fill} />
        <rect x="722.713" y="498.762" width="190.485" height="35.9406" rx="15.5" transform="rotate(-90 722.713 498.762)" fill={fill} />
        <rect x="557.386" y="597" width="180.901" height="35.9406" rx="15" transform="rotate(-90 557.386 597)" fill={fill} />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="296 73 687 687"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: 'inline-block', flexShrink: 0, verticalAlign: 'middle', ...style }}
      {...props}
    >
      <circle cx="639.5" cy="416.5" r="343.5" fill={color} />
      <rect x="428" y="234" width="165.327" height="35.9406" rx="15" fill={glyphColor || '#FFFFFF'} />
      <rect x="428" y="561.059" width="165.327" height="35.9406" rx="15" fill={glyphColor || '#FFFFFF'} />
      <rect x="593.327" y="308.277" width="165.327" height="35.9406" rx="15" fill={glyphColor || '#FFFFFF'} />
      <rect x="722.713" y="462.822" width="129.386" height="35.9406" rx="15" fill={glyphColor || '#FFFFFF'} />
      <rect x="593.327" y="489.178" width="129.386" height="35.9406" rx="15" fill={glyphColor || '#FFFFFF'} />
      <rect x="557.386" y="416.099" width="182.099" height="35.9406" rx="15" transform="rotate(-90 557.386 416.099)" fill={glyphColor || '#FFFFFF'} />
      <rect x="722.713" y="498.762" width="190.485" height="35.9406" rx="15.5" transform="rotate(-90 722.713 498.762)" fill={glyphColor || '#FFFFFF'} />
      <rect x="557.386" y="597" width="180.901" height="35.9406" rx="15" transform="rotate(-90 557.386 597)" fill={glyphColor || '#FFFFFF'} />
    </svg>
  );
}
