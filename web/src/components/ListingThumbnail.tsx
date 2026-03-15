'use client';

interface ListingThumbnailProps {
  photoUrl: string | null;
  alt: string;
  size?: 'card' | 'tooltip';
}

export default function ListingThumbnail({
  photoUrl,
  alt,
  size = 'card',
}: ListingThumbnailProps) {
  const sizeClassName =
    size === 'tooltip'
      ? 'h-14 w-14 rounded-xl'
      : 'h-24 w-24 rounded-2xl';

  if (!photoUrl) {
    return (
      <div
        className={`flex ${sizeClassName} flex-shrink-0 items-center justify-center bg-black/30 text-[11px] text-stone-600`}
      >
        No photo
      </div>
    );
  }

  return (
    <img
      src={photoUrl}
      alt={alt}
      className={`${sizeClassName} flex-shrink-0 object-cover`}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}
