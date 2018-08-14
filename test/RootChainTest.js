const utils = require("ethereumjs-util");
const { latestTime } = require('./helpers/latestTime');
const { increaseTime, duration } = require('./helpers/increaseTime');
const { EVMRevert } = require('./helpers/EVMRevert');
const { expectThrow } = require('./helpers/expectThrow');
const FixedMerkleTree = require('./helpers/fixedMerkleTree');
const Transaction = require('./helpers/transaction');
const { keys } = require('./helpers/keys');

const RootChain = artifacts.require("root_chain.vyper");
const PriorityQueue = artifacts.require("priority_queue.vyper");

const rlp = utils.rlp;
const BigNumber = web3.BigNumber;

require('chai')
    .use(require('chai-as-promised'))
    .use(require('chai-bignumber')(BigNumber))
    .should();


contract("RootChain", ([owner, nonOwner, priorityQueueAddr]) => {
    let rootChain;
    const depositAmount = new BigNumber(web3.toWei(0.1, 'ether'));
    const depositAmountNum = Number(depositAmount);
    const utxoOrder = new BigNumber(1000000000);
    const num1 = new BigNumber(1);
    const num2 = new BigNumber(2);

    const owenerKey = keys[0];
    const nonOwnerKey = keys[1];
    const ZERO_ADDRESS = utils.bufferToHex(utils.zeros(20));

    beforeEach(async () => {
        priorityQueue = await PriorityQueue.new();
        rootChain = await RootChain.new(priorityQueue.address, { from: owner });
    });

    describe("submitBlock", () => {
        it("should update block numbers", async () => {

        });
    });

    describe("deposit", () => {
        it("should accespt deposit", async () => {
            const blknum = await this.rootChain.getDepositBlock();
            await this.rootChain.deposit({ value: depositAmount, from: owner });
            const depositBlockNum = await this.rootChain.getDepositBlock();
            depositBlockNum.should.be.bignumber.equal(blknum.plus(new BigNumber(1)));
        })
    });

    describe("startDepositExit", () => {
        beforeEach(async () => {
            await this.rootChain.deposit({ depositAmount, from: owner });
            this.blknum = await this.rootChain.getDepositBlock();
            await this.rootChain.deposit({ depositAmount, from: owner });
            this.expectedUtxoPos = this.blknum.mul(utxoOrder);
        })

        it("should be equal utxo_pos and exitable_at ", async () => {
            const expectedExitable_at = (await latestTime()) + duration.weeks(2);

            await this.rootChain.startDepositExit(this.expectedUtxoPos, ZERO_ADDRESS, depositAmountNum);
            const [utxo_pos, exitable_at] = await this.rootChain.getNextExit(ZERO_ADDRESS);

            utxo_pos.should.be.bignumber.equal(this.expectedUtxoPos);
            exitable_at.should.be.bignumber.equal(expectedExitable_at);
            this.rootChain.getExit(utxo_pos).to.have.ordered.members([owner, ZERO_ADDRESS, depositAmount])

        });

        it("should fail if same deposit is exited twice", async () => {
            await this.rootChain.startDepositExit(this.expectedUtxoPos, ZERO_ADDRESS, depositAmountNum);
            await expectThrow(this.rootChain.startDepositExit(this.expectedUtxoPos, ZERO_ADDRESS, depositAmountNum), EVMRevert);
        });

        it("should fail if transaction sender is not the depositor", async () => {
            await expectThrow(this.rootChain.startDepositExit(this.expectedUtxoPos, ZERO_ADDRESS, depositAmountNum, { from: nonOwner }), EVMRevert);
        });

        it("should fail if utxo_pos is worng", async () => {
            await expectThrow(this.rootChain.startDepositExit(this.expectedUtxoPos * 2, ZERO_ADDRESS, depositAmountNum), EVMRevert);
        });

        it("should fail if value given is not equal to deposited value", async () => {
            await expectThrow(this.rootChain.startDepositExit(this.expectedUtxoPos, ZERO_ADDRESS, depositAmountNum + 1), EVMRevert);
        })
    });

    describe("startFeeExit", () => {
        it("feePriority should be larger than depositPriority", async () => {
            let utxoPos, exitableAt;

            const blknum = await rootChain.getDepositBlock();
            await rootChain.deposit({ value: depositAmount, from: owner });
            const expectedUtxoAt = await rootChain.getCurrentFeeExit();
            const expectedExitableAt = (await latestTime()) + duration.weeks(2) + 1;

            (await rootChain.getCurrentFeeExit()).should.be.bignumber.equal(num1);
            await rootChain.startFeeExit(ZERO_ADDRESS, 1);
            (await rootChain.getCurrentFeeExit()).should.be.bignumber.equal(num2);

            [utxoPos, exitableAt] = await rootChain.getNextExit(ZERO_ADDRESS);
            const feePriority = exitableAt << 128 | utxoPos;

            utxoPos.should.be.bignumber.equal(expectedUtxoAt);
            exitableAt.should.be.bignumber.equal(expectedExitableAt);

            const expectedUtxoPos = blknum.mul(utxoOrder).plus(num1);
            await rootChain.startDepositExit(expectedUtxoPos, ZERO_ADDRESS, depositAmount);

            [utxoPos, exitableAt] = await rootChain.getNextExit(ZERO_ADDRESS);
            const depositPriotiy = exitableAt << 128 | utxoPos;
            feePriority.should.to.be.above(depositPriotiy);
        });

        it("should fail if transaction sender isn't the authority", async () => {
            await rootChain.deposit({ value: depositAmount, from: owner });
            await expectThrow(rootChain.startFeeExit(ZERO_ADDRESS, 1, { from: nonOwner }), EVMRevert);
        });
    });

    describe("startExit", () => {
        let expectedOwner, tokenAddr, expectedAmount;
        beforeEach(async () => {

        });

        it("cannot exit twice off of the same utxo", async () => {
            const tx1 = new Transaction(0, 0, 0, 0, 0, 0, ZERO_ADDRESS, owner, depositAmount, ZERO_ADDRESS, 0); // TODO
            // const txBytes1 = rlp.encode([0, 0, 0, 0, 0, 0, ZERO_ADDRESS, owner, depositAmount, ZERO_ADDRESS, 0]);
            const depositTxHash = utils.sha3(owner + ZERO_ADDRESS + depositAmount); // TODO
            const depositBlknum = await rootChain.getDepositBlock();
            depositBlknum.should.be.equal(num1);

            await rootChain.deposit({ value: depositAmount, from: owner });
            const merkle = new FixedMerkleTree(16, [depositTxHash]);
            const proof = utils.bufferToHex(Buffer.concat(merkle.getplasmaProof(depositTxHash)));
            const confirmationSig1 = confirmTx(tx1, (await rootChain.getChildChain(depositBlknum)[0]), owenerKey);
            const priority1 = depositBlknum * 1000000000 + 10000 * 0 + 1;
            const sigs = tx1.sig1 + tx1.sig2 + confirmationSig1;
            const utxoId = depositBlknum * 1000000000 + 10000 * 0 + 1;

            await rootChain.startDepositExit(utxoId, ZERO_ADDRESS, tx1.amount1);
            await increaseTime(duration.weeks(1.5));

            const utxoPos1 = depositBlknum * 1000000000 + 10000 * 0 + 1;
            await expectThrow(rootChain.startExit(utxoPos1, depositTxHash, proof, sigs), EVMRevert);

            [expectedOwner, tokenAddr, expectedAmount] = await rootChasin.getExit(priority1);
            expectedOwner.should.equal(owner);
            tokenAddr.shoudl.equal(ZERO_ADDRESS);
            expectedAmount.should.be.bignumber.equal(depositAmount);
        });

        it("can exit single input", async () => {
            await rootChain.deposit({ value: depositAmount, from: owner });
            const tx2 = new Transaction(depositBlknum, 0, 0, 0, 0, 0, ZERO_ADDRESS, owner, depositAmount, ZERO_ADDRESS, 0);
            tx2.sign1(key);
            txBytes2 = rlp.encode(tx2); // TODO
            const merkle = new FixedMerkleTree(16, [tx2.merkleHash]);
            const proof = utils.bufferToHex(Buffer.concat(merkle.getplasmaProof(tx2.merkleHash)));
            const childBlknum = await rootChain.currentChildBlock();
            childBlknum.should.be.bignumber.equal(new BigNumber(1000));

            await rootChain.submitBlock(merkle.getRoot());
            const confirmationSig1 = confirmTx(tx2, (await rootChain.getChildChain(childBlknum)[0]), owenerKey);
            const priority2 = childBlknum * 1000000000 + 10000 * 0 + 0;
            const sigs = tx2.sig1 + tx2.sig2 + confirmationSig1;

            const utxoPos2 = childBlknum * 1000000000 + 10000 * 0 + 0;
            await rootChain.startExit(utxoPos2, txBytes2, proof, sigs);
            [expectedOwner, tokenAddr, expectedAmount] = await rootChasin.getExit(priority2);
            expectedOwner.should.equal(owner);
            tokenAddr.shoudl.equal(ZERO_ADDRESS);
            expectedAmount.should.be.bignumber.equal(depositAmount);
        });

        it("can exit double input", async () => {
            await rootChain.deposit({ value: depositAmount, from: owner });

            const childBlknum = await rootChain.currentChildBlock();
            childBlknum.should.be.bignumber.equal(new BigNumber(1000));
            await rootChain.submitBlock(merkle.getRoot());

            const depositBlknum2 = await rootChain.getDepositBlock();
            depositBlknum2.should.be.bignumber.equal(new BigNumber(1001));

            await rootChain.deposit({ value: depositAmount, from: owner });
            const tx3 = new Transaction(childBlknum, 0, 0, depositBlknum2, 0, 0, ZERO_ADDRESS, owner, depositAmount, ZERO_ADDRESS, 0);
            tx3.sign1(key);
            tx3.sign2(key);

            const txBytes3 = rlp.encode(tx3); // TODO
            const merkle = new FixedMerkleTree(16, [tx3.merkleHash]);
            const proof = utils.bufferToHex(Buffer.concat(merkle.getplasmaProof(tx3.merkleHash)));

            const childBlknum2 = await rootChain.currentChildBlock();
            childBlknum2.should.be.bignumber.equal(new BigNumber(2000));

            await rootChain.submitBlock(merkle.getRoot());
            const confirmationSig1 = confirmTx(tx3, (await rootChain.getChildChain(childBlknum2)[0]), owenerKey);
            const confirmationSig2 = confirmTx(tx3, (await rootChain.getChildChain(childBlknum2)[0]), owenerKey);
            const priority3 = childBlknum2 * 1000000000 + 10000 * 0 + 0;
            const sigs = tx2.sig1 + tx2.sig2 + confirmationSig1 + confirmationSig2;
            const utxoPos3 = childBlknum2 * 1000000000 + 10000 * 0 + 0;

            await rootChain.startExit(utxoPos3, txBytes3, proof, sigs);

            [expectedOwner, tokenAddr, expectedAmount] = await rootChasin.getExit(priority3);
            expectedOwner.should.equal(owner);
            tokenAddr.shoudl.equal(ZERO_ADDRESS);
            expectedAmount.should.be.bignumber.equal(depositAmount);
        });
    });

    describe("challengeExit", () => {

    });

    describe("finalizeExits", () => {

    });
});
