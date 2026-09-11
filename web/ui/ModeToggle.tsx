import type { ComponentChildren } from "preact";

export interface ModeOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A row of `.mode` buttons where exactly one is active — Pen/Pencil,
 * Cages/Digits, and so on.
 *
 * `attr` names the data attribute each button carries (`mode`, `kmode`,
 * `kpen`). It is not decoration: style.css and the page tests both address
 * these buttons through it.
 */
export function ModeToggle<T extends string>({
  attr,
  value,
  options,
  onChange,
  className = "modes",
  id,
  hidden,
  children,
}: {
  attr: string;
  value: T;
  options: ModeOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  id?: string;
  hidden?: boolean;
  children?: ComponentChildren;
}) {
  return (
    <div id={id} class={className} hidden={hidden}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          class={"mode" + (option.value === value ? " active" : "")}
          {...{ [`data-${attr}`]: option.value }}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
      {children}
    </div>
  );
}
