import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui/EmptyState';

export function NotFoundPage(): JSX.Element {
  return (
    <EmptyState title="Page not found" action={<Link to="/dashboard">Back to dashboard</Link>}>
      The page you are looking for does not exist.
    </EmptyState>
  );
}
