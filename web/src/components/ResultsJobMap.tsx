'use client';

import dynamic from 'next/dynamic';

const ResultsJobMap = dynamic(() => import('./JobMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-neutral-900 text-neutral-600">
      Loading map...
    </div>
  ),
});

export default ResultsJobMap;
