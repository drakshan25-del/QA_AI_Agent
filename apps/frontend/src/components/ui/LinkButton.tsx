import { Link, type LinkProps } from 'react-router-dom';
import s from './ui.module.css';

type Variant = 'default' | 'primary' | 'danger' | 'ghost';

const variantClass: Record<Variant, string> = {
  default: '',
  primary: s.primary,
  danger: s.danger,
  ghost: s.ghost,
};

/**
 * Navigation styled as a button. Renders a single `<a>` (react-router Link)
 * with button classes — never a `<button>` nested inside an `<a>`, which is
 * invalid HTML and gives keyboard users two tab stops per action
 * (NFR-USA-004, FR-V3-ENT-016).
 */
export function LinkButton({
  variant = 'default',
  small,
  className,
  children,
  ...rest
}: LinkProps & { variant?: Variant; small?: boolean }): JSX.Element {
  const cls = [s.btn, variantClass[variant], small ? s.small : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <Link className={cls} {...rest}>
      {children}
    </Link>
  );
}
