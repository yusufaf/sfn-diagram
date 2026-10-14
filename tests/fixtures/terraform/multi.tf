resource "aws_sfn_state_machine" "orders" {
  name       = "orders"
  role_arn   = "arn:aws:iam::123456789012:role/sfn"
  definition = <<EOF
{ "StartAt": "Order", "States": { "Order": { "Type": "Succeed" } } }
EOF
}

resource "aws_sfn_state_machine" "refunds" {
  name       = "refunds"
  role_arn   = "arn:aws:iam::123456789012:role/sfn"
  definition = <<EOF
{ "StartAt": "Refund", "States": { "Refund": { "Type": "Succeed" } } }
EOF
}
