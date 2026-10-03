import Image from "next/image";

type PackAMLogoProps = {
  width?: number;
  priority?: boolean;
  className?: string;
};

export function PackAMLogo({
  width = 150,
  priority = false,
  className = "",
}: PackAMLogoProps) {
  const height = Math.round(width * 0.82);

  return (
    <Image
      src="/packam-logo.png"
      alt="PackAM"
      width={width}
      height={height}
      priority={priority}
      className={`h-auto w-auto object-contain ${className}`}
    />
  );
}