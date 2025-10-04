export const calculateGarageArea = (garage: { width: number; length: number }): number => {
  return garage.width * garage.length;
};

export const calculateGarageCapacity = (garage: { width: number; length: number }, laneWidth: number = 3, spotLength: number = 12.5): number => {
  const numberOfLanes = Math.floor(garage.width / laneWidth);
  const spotsPerLane = Math.floor(garage.length / spotLength);
  return numberOfLanes * spotsPerLane;
};
