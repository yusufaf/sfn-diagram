import type { AslDefinition } from '../../src/types';

/**
 * Two definitions that returned OK from `aws stepfunctions
 * validate-state-machine-definition` on 2026-10-07 (nothing in the repo reruns
 * it) and together exercise every field the ASL types must accept without a
 * cast. Trimming either weakens `tests/aslTypes.test.ts`.
 */
export const jsonPathDefinition: AslDefinition = {
    Comment: 'Exercises every JSONPath-mode field added in #373',
    StartAt: 'ChargeCard',
    States: {
        ChargeCard: {
            Type: 'Task',
            Resource: 'arn:aws:states:::lambda:invoke',
            InputPath: '$.order',
            Parameters: {
                FunctionName: 'charge',
                'Payload.$': '$',
            },
            ResultSelector: {
                'receipt.$': '$.Payload.receipt',
            },
            ResultPath: '$.charge',
            OutputPath: '$.charge',
            Credentials: {
                RoleArn: 'arn:aws:iam::111122223333:role/Charge',
            },
            Retry: [
                {
                    Comment: 'Back off on throttling',
                    ErrorEquals: ['Lambda.TooManyRequestsException'],
                    IntervalSeconds: 2,
                    MaxAttempts: 5,
                    BackoffRate: 2,
                    MaxDelaySeconds: 30,
                    JitterStrategy: 'FULL',
                },
            ],
            Catch: [
                {
                    ErrorEquals: ['Card.Declined'],
                    ResultPath: null,
                    Next: 'Refund',
                },
                {
                    Comment: 'Anything else goes to the refund path',
                    ErrorEquals: ['States.ALL'],
                    ResultPath: '$.error',
                    Next: 'Refund',
                },
            ],
            Next: 'ProcessCsv',
        },
        Refund: {
            Type: 'Task',
            Resource: 'arn:aws:states:::lambda:invoke',
            Parameters: {
                FunctionName: 'refund',
                'Payload.$': '$',
            },
            Credentials: {
                'RoleArn.$': '$.refundRole',
            },
            End: true,
        },
        ProcessCsv: {
            Type: 'Map',
            ItemReader: {
                Resource: 'arn:aws:states:::s3:getObject',
                ReaderConfig: {
                    InputType: 'CSV',
                    CSVHeaderLocation: 'GIVEN',
                    CSVHeaders: ['userId', 'rating'],
                    CSVDelimiter: 'PIPE',
                    MaxItemsPath: '$.maxItems',
                },
                Parameters: {
                    Bucket: 'ratings',
                    Key: 'ratings.csv',
                },
            },
            ItemProcessor: {
                ProcessorConfig: {
                    Mode: 'DISTRIBUTED',
                    ExecutionType: 'EXPRESS',
                },
                StartAt: 'Score',
                States: {
                    Score: {
                        Type: 'Pass',
                        End: true,
                    },
                },
            },
            MaxConcurrencyPath: '$.concurrency',
            ToleratedFailureCountPath: '$.failureCount',
            ToleratedFailurePercentagePath: '$.failurePercentage',
            ResultPath: null,
            Next: 'ProcessJson',
        },
        ProcessJson: {
            Type: 'Map',
            ItemReader: {
                Resource: 'arn:aws:states:::s3:getObject',
                ReaderConfig: {
                    InputType: 'JSON',
                    ItemsPointer: '/data/items',
                    MaxItems: 100,
                },
                Parameters: {
                    Bucket: 'inventory',
                    Key: 'items.json',
                },
            },
            ItemProcessor: {
                ProcessorConfig: {
                    Mode: 'DISTRIBUTED',
                    ExecutionType: 'STANDARD',
                },
                StartAt: 'Check',
                States: {
                    Check: {
                        Type: 'Pass',
                        End: true,
                    },
                },
            },
            ResultPath: null,
            Next: 'ProcessLogs',
        },
        ProcessLogs: {
            Type: 'Map',
            ItemReader: {
                Resource: 'arn:aws:states:::s3:listObjectsV2',
                ReaderConfig: {
                    InputType: 'JSONL',
                    Transformation: 'LOAD_AND_FLATTEN',
                },
                Parameters: {
                    Bucket: 'logs',
                    Prefix: '2026/10/',
                },
            },
            ItemProcessor: {
                ProcessorConfig: {
                    Mode: 'DISTRIBUTED',
                    ExecutionType: 'EXPRESS',
                },
                StartAt: 'Audit',
                States: {
                    Audit: {
                        Type: 'Pass',
                        End: true,
                    },
                },
            },
            ResultPath: null,
            Next: 'ProcessAthena',
            InputPath: null,
        },
        ProcessAthena: {
            Type: 'Map',
            ItemReader: {
                Resource: 'arn:aws:states:::s3:getObject',
                ReaderConfig: {
                    ManifestType: 'ATHENA_DATA',
                    InputType: 'CSV',
                    CSVHeaderLocation: 'GIVEN',
                    CSVHeaders: ['id'],
                },
                Parameters: {
                    Bucket: 'athena-results',
                    Key: 'query-manifest.csv',
                },
            },
            ItemProcessor: {
                ProcessorConfig: {
                    Mode: 'DISTRIBUTED',
                    ExecutionType: 'EXPRESS',
                },
                StartAt: 'Load',
                States: {
                    Load: {
                        Type: 'Pass',
                        End: true,
                    },
                },
            },
            End: true,
            OutputPath: null,
        },
    },
};

export const jsonataDefinition: AslDefinition = {
    Comment: 'Exercises every JSONata-mode field added in #373',
    QueryLanguage: 'JSONata',
    StartAt: 'ChargeCard',
    States: {
        ChargeCard: {
            Type: 'Task',
            Resource: 'arn:aws:states:::lambda:invoke',
            Arguments: {
                FunctionName: 'charge',
                Payload: '{% $states.input %}',
            },
            Credentials: { RoleArn: '{% $states.input.chargeRole %}' },
            Catch: [
                {
                    Comment: 'Keep the error and remember it',
                    ErrorEquals: ['States.ALL'],
                    Output: '{% $states.errorOutput %}',
                    Assign: { lastError: '{% $states.errorOutput.Error %}' },
                    Next: 'Fanout',
                },
            ],
            Next: 'Fanout',
        },
        Fanout: {
            Type: 'Map',
            Items: '{% $states.input.orders %}',
            ItemBatcher: {
                MaxItemsPerBatch: '{% $states.input.batchSize %}',
                MaxInputBytesPerBatch: '{% 262144 %}',
                BatchInput: "{% {'source': 'orders'} %}",
            },
            ItemProcessor: {
                ProcessorConfig: {
                    Mode: 'DISTRIBUTED',
                    ExecutionType: 'EXPRESS',
                },
                StartAt: 'Ship',
                States: { Ship: { Type: 'Pass', End: true } },
            },
            Next: 'Literal',
        },
        Literal: {
            Type: 'Map',
            Items: [1, 2, 3],
            ItemProcessor: {
                StartAt: 'Echo',
                States: { Echo: { Type: 'Pass', End: true } },
            },
            Next: 'Keyed',
        },
        Keyed: {
            Type: 'Map',
            Items: { east: 1, west: 2 },
            ItemProcessor: {
                ProcessorConfig: {
                    Mode: 'DISTRIBUTED',
                    ExecutionType: 'EXPRESS',
                },
                StartAt: 'Tally',
                States: { Tally: { Type: 'Pass', End: true } },
            },
            Next: 'Reports',
        },
        Reports: {
            Type: 'Map',
            ItemReader: {
                Resource: 'arn:aws:states:::s3:getObject',
                ReaderConfig: {
                    InputType: 'CSV',
                    CSVHeaderLocation: 'FIRST_ROW',
                    MaxItems: '{% $states.input.limit %}',
                },
                Arguments: {
                    Bucket: 'reports',
                    Key: '{% $states.input.key %}',
                },
            },
            ItemProcessor: {
                ProcessorConfig: {
                    Mode: 'DISTRIBUTED',
                    ExecutionType: 'STANDARD',
                },
                StartAt: 'Summarise',
                States: { Summarise: { Type: 'Pass', End: true } },
            },
            ResultWriter: {
                Resource: 'arn:aws:states:::s3:putObject',
                Arguments: {
                    Bucket: 'reports-out',
                    Prefix: '{% $states.input.runId %}',
                },
                WriterConfig: { OutputType: 'JSON', Transformation: 'COMPACT' },
            },
            End: true,
        },
    },
};
