import PWCore, {
  Builder,
  Amount,
  AmountUnit,
  Transaction,
  RawTransaction,
  Cell,
} from "@lay2/pw-core";
export default class SDBuilder extends Builder {
  constructor(inputCell, outputCell) {
    super();
    this.inputCell = inputCell;
    this.outputCell = outputCell;
  }

  async build(fee) {
    let inputCells = [];
    let inputSum;
    if (this.inputCell) {
      // if inputCell is provided, it should be comsumed.
      inputCells.push(this.inputCell);
    }

    let neededAmount; // amount that need to be fetched

    // if there are provided fee, count it first.
    if (fee) neededAmount = fee;

    if (!this.inputCell) {
      // if no inputCell provided, we need to get all the capacity from unspent cells
      neededAmount = this.outputCell.capacity;
    } else if (this.outputCell) {
      if (this.inputCell.capacity.lt(this.outputCell.capacity)) {
        // if new cell is bigger than the old one, we need extra input cells
        neededAmount = this.outputCell.capacity.sub(this.inputCell.capacity);
      }
    }

    // if in delete mode, changeCell will be the only output cell,
    // which is exactly the inputCell itself.
    let changeCell = this.inputCell;

    if (neededAmount) {
      // we need to fetch unspent cells
      console.log(
        "[sd-builder] neededAmount ",
        neededAmount.toString(AmountUnit.ckb)
      );

      const cells = await this.collector.collect(
        PWCore.provider.address,
        neededAmount,
        { withData: false }
      );

      let sum = Amount.ZERO;

      for (const cell of cells) {
        inputCells.push(cell);
        sum = sum.add(cell.capacity);
        if (sum.gt(neededAmount)) break;
      }

      if (sum.lt(neededAmount)) {
        throw new Error(
          `[1] input capacity not enough, need ${neededAmount.toString(
            AmountUnit.ckb
          )}, got ${sum.toString(AmountUnit.ckb)}`
        );
      }

      inputSum = this.inputCell ? sum.add(this.inputCell.capacity) : sum;

      changeCell = new Cell(
        inputSum.sub(this.outputCell.capacity),
        PWCore.provider.address.toLockScript()
      );
    }

    const outputCells = [changeCell];

    if (this.outputCell) {
      if (changeCell.capacity.lt(Builder.MIN_CHANGE)) {
        // Change cell is too small, so we merge it into the output cell.
        this.outputCell.capacity.add(changeCell.capacity);
        outputCells.pop();
      }
      outputCells.unshift(this.outputCell);
    }

    // the second arg is mainly used to set the length of witness,
    // for more accurate fee calculation.
    const tx = new Transaction(new RawTransaction(inputCells, outputCells), [
      Builder.WITNESS_ARGS.Secp256k1,
    ]);

    this.fee = Builder.calcFee(tx);

    let lastCell = outputCells[outputCells.length - 1];
    if (this.fee.add(Builder.MIN_CHANGE).gt(lastCell.capacity)) {
      // if the last cell (either a change cell or the data cell itself) is too small,
      // we add the fee from this round and build again.
      return this.build(this.fee);
    }

    // sub fee from lastCell
    lastCell.capacity = lastCell.capacity.sub(this.fee);
    tx.raw.outputs.pop();
    tx.raw.outputs.push(lastCell);

    console.log("[sd-builder] tx: ", tx);

    return tx;
  }
}
