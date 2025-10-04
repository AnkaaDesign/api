import type { Observation } from '@types';

export const getObservationWordCount = (description: string): number => {
  return description
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
};

export const extractObservationKeywords = (description: string, minLength: number = 3): string[] => {
  const words = description
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((word) => word.length >= minLength);

  return [...new Set(words)];
};

export const isObservationRecent = (observation: Observation, hoursThreshold: number = 24): boolean => {
  const now = new Date();
  const observationDate = new Date(observation.createdAt);
  const hoursDiff = (now.getTime() - observationDate.getTime()) / (1000 * 60 * 60);

  return hoursDiff <= hoursThreshold;
};

export const getObservationFileTypes = (observation: Observation): string[] => {
  if (!observation.files) return [];

  return [...new Set(observation.files.map((file) => file.mimetype))];
};

export const calculateObservationFileSize = (observation: Observation): number => {
  if (!observation.files) return 0;

  return observation.files.reduce((total, file) => total + file.size, 0);
};
