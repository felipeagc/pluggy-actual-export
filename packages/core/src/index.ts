import { Account, PluggyClient } from "pluggy-sdk";
import {
  OFXBankAccountInfo,
  OFXBankFile,
  OFXCCFile,
  type OFXFile,
  OFXTransaction,
} from "./ofx.ts";
import { getFilterForBank } from "./tx_filters.ts";

const PAGE_SIZE = 300;

export interface Credentials {
  clientId: string;
  clientSecret: string;
}

export class Client {
  private client: PluggyClient;

  constructor(credentials: Credentials) {
    this.client = new PluggyClient(credentials);
  }

  private findBankInfo(accounts: Account[]): OFXBankAccountInfo | undefined {
    const bankAcc = accounts.find((acc) => acc.type === "BANK");
    if (!bankAcc) return undefined;

    const transferNumber = bankAcc.bankData?.transferNumber?.split("/");
    if (!transferNumber) {
      return undefined;
    }
    const fid = transferNumber[0];
    const branch = transferNumber[1].replace("-", "");
    const accountNumber = transferNumber[2].replace("-", "");
    return {
      orgName: bankAcc.name,
      fid: parseInt(fid),
      accountNumber,
      branch,
    };
  }

  async outputOFXFiles(
    itemId: string,
    dateStart: Date,
    dateEnd: Date,
  ): Promise<OFXFile[]> {
    const accounts = await this.client.fetchAccounts(itemId);

    const bankInfo = this.findBankInfo(accounts.results);

    if (!bankInfo) {
      throw new Error("Bank info not found");
    }

    return await Promise.all(
      accounts.results.map(async (acc) => {
        console.log(acc);

        let ofxFile;
        switch (acc.type) {
          case "BANK":
            ofxFile = new OFXBankFile(
              bankInfo,
              "CHECKING",
              acc.currencyCode,
              dateStart,
              dateEnd,
            );
            break;
          case "CREDIT":
            ofxFile = new OFXCCFile(
              bankInfo,
              {
                brand: acc.creditData!.brand ?? "Unknown",
                level: acc.creditData!.level ?? "Unknown",
                number: acc.number,
              },
              acc.id,
              acc.currencyCode,
              dateStart,
              dateEnd,
            );
            break;
          default:
            throw new Error("Account type not supported");
        }

        const txs = await this.client.fetchTransactions(acc.id, {
          from: dateStart.toISOString(),
          to: dateEnd.toISOString(),
          pageSize: PAGE_SIZE,
        });
        if (txs.totalPages != 1) {
          throw new Error(
            `Pagination not supported, total pages: ${txs.totalPages}, total: ${txs.total}`,
          );
        }

        const txFilter = getFilterForBank(bankInfo.fid);

        for (let tx of txs.results) {
          console.log(tx);
          if (txFilter) {
            const newTx = txFilter(tx);
            if (newTx) {
              tx = newTx;
            } else {
              continue;
            }
          }

          const ofxTx = new OFXTransaction(
            tx.id,
            tx.type,
            tx.amount,
            tx.description,
            tx.date,
          );
          ofxFile.addTx(ofxTx);
        }

        return ofxFile;
      }),
    );
  }
}