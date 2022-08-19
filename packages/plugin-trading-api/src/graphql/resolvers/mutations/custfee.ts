import { prisma } from '../../../configs';
const custFeeMutations = {
  async custFeeAdd(parent, args) {
    return prisma.custfee.create({
      data: {
        userId: args.userId,
        stocktypeId: args.stockTypeId,
        name: args.name,
        name2: args.name2,
        descr: args.desc,
        value: args.value,
        sidetype: 1,
        status: 1
      }
    });
  }
};
export default custFeeMutations;
