resource "aws_sfn_state_machine" "from_file" {
  name       = "from-file"
  role_arn   = "arn:aws:iam::123456789012:role/sfn"
  definition = file("sfn.asl.json")
}
