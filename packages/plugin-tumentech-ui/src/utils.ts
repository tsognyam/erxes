import { ICar } from './types';

export const generateTree = (
  list,
  parentId,
  callback,
  level = -1,
  parentKey = 'parentId'
) => {
  const filtered = list.filter(c => c[parentKey] === parentId);

  if (filtered.length > 0) {
    level++;
  } else {
    level--;
  }

  return filtered.reduce((tree, node) => {
    return [
      ...tree,
      callback(node, level),
      ...generateTree(list, node._id, callback, level, parentKey)
    ];
  }, []);
};

export const carInfo = (car: ICar) => {
  if (car.carModel || car.category || car.vinNumber || car.plateNumber) {
    return (
      (car.carModel || '') +
      ' ' +
      (car.category?.name || '') +
      ' ' +
      (car.vinNumber || '') +
      ' ' +
      (car.plateNumber || '')
    );
  }

  return 'Unknown';
};
