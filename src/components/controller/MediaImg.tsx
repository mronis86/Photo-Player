import { useMediaUrl } from '../../hooks/useMediaUrl';

interface MediaImgProps {
  src: string;
  userId: string | null;
  className?: string;
  alt?: string;
  style?: React.CSSProperties;
}

/**
 * Renders an img with cue.src, resolving Supabase storage paths to signed URLs.
 */
export function MediaImg({ src, userId, className, alt = '', style }: MediaImgProps) {
  const { url, loading } = useMediaUrl(src, userId);

  if (!src) return null;
  const displayUrl = url || (loading ? '' : src);
  if (!displayUrl) {
    return (
      <div
        className={className}
        style={{ ...style, background: 'var(--s3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 11 }}
      >
        Loading…
      </div>
    );
  }

  return <img src={displayUrl} alt={alt} className={className} style={style} />;
}
