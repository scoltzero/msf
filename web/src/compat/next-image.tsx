import type { ImgHTMLAttributes } from "react";

type NextImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  width?: number;
  height?: number;
  priority?: boolean;
  fill?: boolean;
};

export default function NextImage({
  src,
  alt,
  width,
  height,
  priority: _priority,
  fill: _fill,
  ...props
}: NextImageProps) {
  return <img src={src} alt={alt ?? ""} width={width} height={height} {...props} />;
}
