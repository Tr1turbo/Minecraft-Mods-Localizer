import type { ChangeEvent, ReactNode } from "react";

export function FilePicker({
  label,
  accept,
  multiple,
  onChange,
  icon,
}: {
  label: string;
  accept: string;
  multiple?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  icon: ReactNode;
}) {
  return (
    <label className="fileButton">
      {icon}
      {label}
      <input type="file" accept={accept} multiple={multiple} onChange={onChange} />
    </label>
  );
}
